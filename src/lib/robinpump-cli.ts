/**
 * RobinPump CLI — a custom just-bash command for exploring RobinPump data.
 *
 * Registered as `robinpump` in the sandbox so the AI agent can discover
 * coins, prices, trades, and metadata on demand instead of having
 * everything injected into the system prompt.
 *
 * All output is JSON for easy machine parsing.
 */

import { defineCommand } from "just-bash";
import { parseArgs } from "node:util";
import { RobinPump } from "../../robinpump";

const HELP = `Usage: robinpump <command> [options]

Commands:
  coins                       List coins on RobinPump
  coin <pair>                 Get details for a coin by pair address
  trades <pair>               Get recent trades for a coin
  metadata <pair>             Fetch IPFS metadata (description, image)
  search <query>              Search coins by name or symbol
  eth-price                   Get current ETH/USD price
  help                        Show this help message

Options for 'coins':
  --sort <newest|marketCap>   Sort order (default: newest)
  --limit <n>                 Max results (default: 50, max: 200)
  --offset <n>                Pagination offset (default: 0)

Options for 'trades':
  --limit <n>                 Max results (default: 20, max: 100)

All data commands output JSON.
`;

export const robinpumpCommand = defineCommand("robinpump", async (args) => {
  const subcommand = args[0] ?? "help";
  const subArgs = args.slice(1);

  try {
    if (subcommand === "coins") {
      return await handleCoins(subArgs);
    }
    if (subcommand === "coin") {
      return await handleCoin(subArgs);
    }
    if (subcommand === "trades") {
      return await handleTrades(subArgs);
    }
    if (subcommand === "metadata") {
      return await handleMetadata(subArgs);
    }
    if (subcommand === "search") {
      return await handleSearch(subArgs);
    }
    if (subcommand === "eth-price") {
      return await handleEthPrice();
    }
    if (subcommand === "help" || subcommand === "--help" || subcommand === "-h") {
      return { stdout: HELP, stderr: "", exitCode: 0 };
    }

    return {
      stdout: "",
      stderr: `Unknown command: ${subcommand}\nRun 'robinpump help' for usage.\n`,
      exitCode: 1,
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { stdout: "", stderr: `Error: ${msg}\n`, exitCode: 1 };
  }
});

/* ── Subcommand handlers ─────────────────────────────────────────── */

async function handleCoins(subArgs: string[]) {
  const { values } = parseArgs({
    args: subArgs,
    options: {
      sort: { type: "string", default: "newest", short: "s" },
      limit: { type: "string", default: "50", short: "l" },
      offset: { type: "string", default: "0", short: "o" },
    },
    strict: false,
  });

  const sort = values.sort === "marketCap" ? ("marketCap" as const) : ("newest" as const);
  const limit = Math.min(parseInt(String(values.limit ?? "50"), 10) || 50, 200);
  const offset = parseInt(String(values.offset ?? "0"), 10) || 0;

  const [coins, ethUsdPrice] = await Promise.all([
    RobinPump.fetchCoins(sort, limit, offset),
    RobinPump.getEthUsdPrice().catch(() => 2500),
  ]);

  const result: Record<string, unknown>[] = [];
  for (const c of coins) {
    result.push({
      pair: c.pairAddress,
      token: c.tokenAddress,
      name: c.name,
      symbol: c.symbol,
      priceEth: c.lastPriceEth,
      priceUsd: c.lastPriceUsd,
      marketCapUsd: Math.round(c.ethCollected * ethUsdPrice),
      volumeEth: round(c.totalVolumeEth, 4),
      trades: c.tradeCount,
      graduated: c.graduated,
      createdAt: new Date(c.createdAt * 1000).toISOString(),
    });
  }

  return {
    stdout: JSON.stringify({ ethUsdPrice, count: result.length, coins: result }, null, 2) + "\n",
    stderr: "",
    exitCode: 0,
  };
}

async function handleCoin(subArgs: string[]) {
  const pairAddress = subArgs[0];
  if (pairAddress === undefined || pairAddress === "") {
    return {
      stdout: "",
      stderr: "Error: pair address required\nUsage: robinpump coin <pairAddress>\n",
      exitCode: 1,
    };
  }

  const [coin, ethUsdPrice] = await Promise.all([
    RobinPump.fetchCoin(pairAddress),
    RobinPump.getEthUsdPrice().catch(() => 2500),
  ]);

  if (coin === null) {
    return { stdout: "", stderr: `Error: coin not found for pair ${pairAddress}\n`, exitCode: 1 };
  }

  const result = {
    pair: coin.pairAddress,
    token: coin.tokenAddress,
    name: coin.name,
    symbol: coin.symbol,
    uri: coin.uri,
    creator: coin.creator,
    priceEth: coin.lastPriceEth,
    priceUsd: coin.lastPriceUsd,
    marketCapUsd: Math.round(coin.ethCollected * ethUsdPrice),
    ethCollected: round(coin.ethCollected, 6),
    volumeEth: round(coin.totalVolumeEth, 4),
    trades: coin.tradeCount,
    graduated: coin.graduated,
    createdAt: new Date(coin.createdAt * 1000).toISOString(),
    ethUsdPrice,
  };

  return {
    stdout: JSON.stringify(result, null, 2) + "\n",
    stderr: "",
    exitCode: 0,
  };
}

async function handleTrades(subArgs: string[]) {
  const pairAddress = subArgs[0];
  if (pairAddress === undefined || pairAddress === "") {
    return {
      stdout: "",
      stderr: "Error: pair address required\nUsage: robinpump trades <pairAddress> [--limit N]\n",
      exitCode: 1,
    };
  }

  const tradeArgs = subArgs.slice(1);
  const { values } = parseArgs({
    args: tradeArgs,
    options: {
      limit: { type: "string", default: "20", short: "l" },
    },
    strict: false,
  });
  const limit = Math.min(parseInt(String(values.limit ?? "20"), 10) || 20, 100);

  const trades = await RobinPump.fetchTrades(pairAddress, limit);

  const result: Record<string, unknown>[] = [];
  for (const t of trades) {
    result.push({
      side: t.side,
      amountEth: round(t.amountEth, 6),
      amountToken: round(t.amountToken, 2),
      priceEth: t.priceEth,
      priceUsd: t.priceUsd,
      trader: t.trader,
      time: new Date(t.timestamp * 1000).toISOString(),
      txHash: t.txHash,
    });
  }

  return {
    stdout:
      JSON.stringify({ pair: pairAddress, count: result.length, trades: result }, null, 2) + "\n",
    stderr: "",
    exitCode: 0,
  };
}

async function handleMetadata(subArgs: string[]) {
  const pairAddress = subArgs[0];
  if (pairAddress === undefined || pairAddress === "") {
    return {
      stdout: "",
      stderr: "Error: pair address required\nUsage: robinpump metadata <pairAddress>\n",
      exitCode: 1,
    };
  }

  const coin = await RobinPump.fetchCoin(pairAddress);
  if (coin === null) {
    return { stdout: "", stderr: `Error: coin not found for pair ${pairAddress}\n`, exitCode: 1 };
  }

  const meta = await RobinPump.fetchMetadata(coin.uri);
  if (meta === null) {
    return {
      stdout: "",
      stderr: `Error: metadata not available for ${coin.symbol} (${coin.uri})\n`,
      exitCode: 1,
    };
  }

  const imageUrl = meta.image !== "" ? RobinPump.resolveImageUrl(meta.image) : null;

  return {
    stdout:
      JSON.stringify(
        {
          pair: coin.pairAddress,
          name: meta.name,
          symbol: meta.symbol,
          description: meta.description,
          image: imageUrl,
          createdOn: meta.createdOn,
        },
        null,
        2,
      ) + "\n",
    stderr: "",
    exitCode: 0,
  };
}

async function handleSearch(subArgs: string[]) {
  const query = subArgs.join(" ").toLowerCase().trim();
  if (query === "") {
    return {
      stdout: "",
      stderr: "Error: search query required\nUsage: robinpump search <query>\n",
      exitCode: 1,
    };
  }

  const [coins, ethUsdPrice] = await Promise.all([
    RobinPump.fetchCoins("marketCap", 200),
    RobinPump.getEthUsdPrice().catch(() => 2500),
  ]);

  const matches: Record<string, unknown>[] = [];
  for (const c of coins) {
    const nameMatch = c.name.toLowerCase().includes(query);
    const symbolMatch = c.symbol.toLowerCase().includes(query);
    if (!nameMatch && !symbolMatch) continue;

    matches.push({
      pair: c.pairAddress,
      token: c.tokenAddress,
      name: c.name,
      symbol: c.symbol,
      priceEth: c.lastPriceEth,
      priceUsd: c.lastPriceUsd,
      marketCapUsd: Math.round(c.ethCollected * ethUsdPrice),
      volumeEth: round(c.totalVolumeEth, 4),
      trades: c.tradeCount,
      graduated: c.graduated,
    });
  }

  return {
    stdout:
      JSON.stringify({ query, ethUsdPrice, count: matches.length, coins: matches }, null, 2) + "\n",
    stderr: "",
    exitCode: 0,
  };
}

async function handleEthPrice() {
  const price = await RobinPump.getEthUsdPrice();
  return {
    stdout:
      JSON.stringify({ ethUsdPrice: price, timestamp: new Date().toISOString() }, null, 2) + "\n",
    stderr: "",
    exitCode: 0,
  };
}

/* ── Utils ───────────────────────────────────────────────────────── */

function round(n: number, decimals: number) {
  const factor = 10 ** decimals;
  return Math.round(n * factor) / factor;
}

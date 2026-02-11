function isHexCharCode(c: number) {
  const isNum = c >= 48 && c <= 57;
  const isLower = c >= 97 && c <= 102;
  const isUpper = c >= 65 && c <= 70;
  return isNum || isLower || isUpper;
}

export function isHexPrefixed(value: string): value is `0x${string}` {
  return value.startsWith("0x");
}

export function isHexPrivateKey(value: string): value is `0x${string}` {
  if (!value.startsWith("0x")) return false;
  if (value.length !== 66) return false;
  for (let i = 2; i < value.length; i++) {
    const c = value.charCodeAt(i);
    if (!isHexCharCode(c)) return false;
  }
  return true;
}


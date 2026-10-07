const warehouseInfoCache = new Map();

export function parseWarehouseInfo(binLocation = "") {
  const loc = String(binLocation || "").trim();
  if (warehouseInfoCache.has(loc)) {
    return warehouseInfoCache.get(loc);
  }

  let result;
  if (!loc || loc === "위치 미정" || loc === "위치 미지정" || loc === "조회중") {
    result = {
      category: "NO_BIN",
      label: "위치 미지정",
      storeShelf: null,
      newShelf: null,
      isStore: false,
      isNewOnly: false,
      hasBoth: false,
    };
  } else {
    const matchBoth = loc.match(/^(.*?)\s*\(신창고:\s*(.*?)\)$/);
    if (matchBoth) {
      result = {
        category: "STORE",
        label: loc,
        storeShelf: matchBoth[1].trim(),
        newShelf: matchBoth[2].trim(),
        isStore: true,
        isNewOnly: false,
        hasBoth: true,
      };
    } else if (loc.startsWith("*") || loc.includes("신창고")) {
      const cleanNew = loc.replace(/^\*/, "").replace(/\(신창고\)/, "").trim();
      result = {
        category: "NEW_ONLY",
        label: loc,
        storeShelf: null,
        newShelf: cleanNew,
        isStore: false,
        isNewOnly: true,
        hasBoth: false,
      };
    } else {
      result = {
        category: "STORE",
        label: loc,
        storeShelf: loc,
        newShelf: null,
        isStore: true,
        isNewOnly: false,
        hasBoth: false,
      };
    }
  }

  if (warehouseInfoCache.size < 1000) {
    warehouseInfoCache.set(loc, result);
  }
  return result;
}

export function compareRegalAscending(a, b) {
  if (!a && !b) return 0;
  if (!a) return 1;
  if (!b) return -1;

  const infoA = a.whInfo || parseWarehouseInfo(a.binLocation);
  const infoB = b.whInfo || parseWarehouseInfo(b.binLocation);

  const shelfA = String(infoA?.storeShelf || infoA?.newShelf || a.binLocation || "ZZZ");
  const shelfB = String(infoB?.storeShelf || infoB?.newShelf || b.binLocation || "ZZZ");

  return shelfA.localeCompare(shelfB, undefined, { numeric: true, sensitivity: "base" });
}

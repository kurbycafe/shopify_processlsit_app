// Makes a non-button element (card, tile, chip) usable by keyboard and screen readers.
export function pressable(onPress) {
  if (!onPress) return {};
  return {
    role: "button",
    tabIndex: 0,
    onClick: onPress,
    onKeyDown: (event) => {
      // Keys pressed on a nested button belong to that button.
      if (event.target !== event.currentTarget) return;
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        onPress(event);
      }
    },
  };
}

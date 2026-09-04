(function (STB) {
  "use strict";

  STB.PALETTE = [
    { name: "butter", bg: "#F5E6A8", ink: "#6B4E12" },
    { name: "sage", bg: "#C9D6B8", ink: "#3A4B24" },
    { name: "sky", bg: "#B9D3DD", ink: "#20424C" },
    { name: "blush", bg: "#E8C5C0", ink: "#6B322A" },
    { name: "lavender", bg: "#D3C5DE", ink: "#4A2F59" },
  ];
  STB.DAY_LETTERS = ["S", "M", "T", "W", "T", "F", "S"];
  STB.DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  STB.STORAGE_KEY = "sticky-board";
  STB.IOS_TIP_KEY = "sticky-board-ios-tip-dismissed";
  STB.RING_R = 50;
  STB.RING_C = 2 * Math.PI * STB.RING_R;
  STB.NOTE_W = 210;
  STB.NOTE_H_ESTIMATE = 190;
  STB.TWO_LINE_HEIGHT = 40; // ~2 lines at 14px font, 1.35 line-height
  STB.MAX_NOTE_WIDTH = 420; // a note auto-widens to fit tasks in 2 lines, up to this cap
  STB.DOC_W = 260;
  STB.DOC_H_ESTIMATE = 260;
  STB.MIN_CANVAS_W = 700; // used only to decide how many grid columns fit -- narrow
                          // screens still get a multi-column layout and scroll to reach it

  STB.ICON = {
    x: function (size, color) {
      return '<svg width="' + size + '" height="' + size + '" viewBox="0 0 24 24" fill="none" stroke="' + (color || "currentColor") + '" stroke-width="2.5" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';
    },
    check: function (size, color) {
      return '<svg width="' + size + '" height="' + size + '" viewBox="0 0 24 24" fill="none" stroke="' + (color || "currentColor") + '" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>';
    },
    plus: function (size) {
      return '<svg width="' + size + '" height="' + size + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>';
    },
    flame: function (size) {
      return '<svg width="' + size + '" height="' + size + '" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2c1 4-4 5-4 9a4 4 0 0 0 8 0c0-1-1-2-1-3 1 1 3 3 3 6a6 6 0 0 1-12 0c0-5 3-6 6-12z"/></svg>';
    },
    chevronDown: function (size) {
      return '<svg width="' + size + '" height="' + size + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>';
    },
    repeat: function (size) {
      return '<svg width="' + size + '" height="' + size + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="17 1 21 5 17 9"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><polyline points="7 23 3 19 7 15"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/></svg>';
    },
    copy: function (size) {
      return '<svg width="' + size + '" height="' + size + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>';
    },
    popout: function (size) {
      return '<svg width="' + size + '" height="' + size + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>';
    },
    restore: function (size) {
      return '<svg width="' + size + '" height="' + size + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><polyline points="3 3 3 8 8 8"/></svg>';
    },
    bookmark: function (size) {
      return '<svg width="' + size + '" height="' + size + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg>';
    },
    bell: function (size) {
      return '<svg width="' + size + '" height="' + size + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>';
    },
  };
})(window.STB = window.STB || {});

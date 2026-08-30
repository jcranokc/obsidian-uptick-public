class Modal {
  constructor(app) { this.app = app; this.contentEl = mkNode("div"); this.modalEl = mkNode("div"); }
  open() { this.onOpen && this.onOpen(); }
  close() { this.onClose && this.onClose(); }
}
class Plugin {}
/* FormModal/PromptModal are driven by a scripted answer under test: the real
   ones await a click, which never comes in a headless run. */
Modal.prototype.open = function () {
  if (this.opts && this.resolve) {
    this.resolve(global.__formAnswer ?? null);
    return;
  }
  this.onOpen && this.onOpen();
}; class ItemView {} class MarkdownRenderChild {} class TFile {}
function Notice(msg) { this.msg = msg; }
const { mkNode } = require("../../domshim.js");
const moment = require("../../momentshim.js");
/* The network call the Library makes. Tests drive it by setting
   global.__requestUrl; unset, it refuses rather than reaching the network,
   so a test can never accidentally make a real request. */
async function requestUrl(opts) {
  if (typeof global.__requestUrl === "function") return global.__requestUrl(opts);
  throw new Error("network disabled in tests (set global.__requestUrl)");
}

module.exports = { requestUrl, MarkdownRenderChild, Plugin, ItemView, Notice, TFile, Modal, moment };

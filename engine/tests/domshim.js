class N {
  constructor(tag) { this.tag = tag; this.children = []; this.classes = new Set();
    this.text = ""; this.attrs = {}; this.listeners = {}; this.style = {}; this.dataset = {}; }
  createEl(tag, o = {}) {
    const n = new N(tag);
    if (o.cls) String(o.cls).split(/\s+/).filter(Boolean).forEach(c => n.classes.add(c));
    if (o.text) n.text = o.text;
    n.parent = this; this.children.push(n); return n;
  }
  createDiv(o) { return this.createEl("div", o); }
  createSpan(o) { return this.createEl("span", o); }
  setText(t) { this.text = String(t); }
  getText() { return this.text; }
  appendText(t) { this.text += String(t); return this; }
  insertBefore(n) { this.children.unshift(n); return n; }
  replaceChildren(...n) { this.children = n; }
  get innerHTML() { return this.text; }
  set innerHTML(v) { this.text = String(v); }
  get textContent() { return this.text + this.children.map((c) => c.textContent).join(""); }
  addClass(...c) { c.forEach(x => String(x).split(/\s+/).filter(Boolean).forEach(y => this.classes.add(y))); }
  removeClass(...c) { c.forEach(x => this.classes.delete(x)); }
  hasClass(c) { return this.classes.has(c); }
  empty() { this.children = []; }
  /* Listeners are recorded, not discarded. onTap() drives a real click through
   * pointerdown -> click, so a handler that never fires is a test failure
   * rather than a silent pass. */
  addEventListener(type, fn) { (this.listeners[type] ||= []).push(fn); }
  __fire(type, ev = {}) {
    return Promise.all((this.listeners[type] || []).map((fn) => fn(ev)));
  }
  async __tap() {
    const ev = { clientX: 0, clientY: 0, preventDefault() {}, stopPropagation() {} };
    await this.__fire("pointerdown", ev);
    await this.__fire("click", ev);
    /* mkBtn assigns .onclick directly rather than going through
     * addEventListener, so a tap that only fired listeners would miss every
     * button in the plugin. */
    if (typeof this.onclick === "function") await this.onclick(ev);
  }
  remove() {
    const i = this.parent ? this.parent.children.indexOf(this) : -1;
    if (i >= 0) this.parent.children.splice(i, 1);
  }
  setAttribute(k, v) { this.attrs[k] = v; }
  /* Obsidian's own DOM extensions, which the plugin uses freely. */
  setAttr(k, v) { this.attrs[k] = v; return this; }
  setAttrs(o) { Object.assign(this.attrs, o); return this; }
  toggleClass(c, on) { on ? this.addClass(c) : this.removeClass(c); return this; }
  setCssStyles(o) { Object.assign(this.style, o); return this; }
  detach() { if (this.parent) this.parent.children = this.parent.children.filter(n => n !== this); }
  onClickEvent() { return this; }
  find(sel) { return this.findAll(sel)[0] ?? null; }
  appendChild(n) { this.children.push(n); return n; }
  querySelector() { return null; }
  get classList() { return { contains: (c) => this.classes.has(c) }; }
  get childElementCount() { return this.children.length; }
  get offsetHeight() { return 100; }
  findAll(sel) {
    const want = sel.replace(/^\./, ""); const out = [];
    (function walk(n) { for (const c of n.children) { if (c.classes.has(want)) out.push(c); walk(c); } })(this);
    return out;
  }
  all() { const out = []; (function w(n) { for (const c of n.children) { out.push(c); w(c); } })(this); return out; }
  count(cls) { return this.all().filter(n => n.classes.has(cls)).length; }
  textOf(cls) { return this.all().filter(n => n.classes.has(cls)).map(n => n.text); }
}
module.exports = { N, mkNode: (t) => new N(t) };

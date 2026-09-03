// Minimal mock of @earendil-works/pi-tui for tests
// Stubs Container, Spacer, Text with basic render support

export class Container {
  constructor() {
    this.children = [];
  }
  addChild(child) {
    this.children.push(child);
  }
  render(width) {
    return this.children.flatMap(c => c.render(width));
  }
  invalidate() {
    for (const c of this.children) c.invalidate?.();
  }
}

export class Spacer {
  constructor(height = 1) {
    this.height = height;
  }
  render(_width) {
    return Array(this.height).fill("");
  }
}

export class Text {
  constructor(content, x = 0, y = 0) {
    this._content = content;
    this.x = x;
    this.y = y;
  }
  render(width) {
    if (!this._content) return [""];
    const lines = [];
    for (const line of this._content.split("\n")) {
      let rest = line;
      while (rest.length > width) {
        lines.push(rest.slice(0, width));
        rest = rest.slice(width);
      }
      lines.push(rest);
    }
    return lines;
  }
  invalidate() {}
}

export class Markdown {
  constructor(content, x = 0, y = 0, _theme) {
    this._content = content;
  }
  render(width) {
    return new Text(this._content, 0, 0).render(width);
  }
  invalidate() {}
}

// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";
import { renderMarkdown } from "./markdown";

function render(source: string) {
  return renderMarkdown(source, vi.fn());
}

describe("renderMarkdown", () => {
  it("renders CommonMark blocks and common GFM structures", () => {
    const root = render(`# Heading

First line
second line

> Quoted **strong** and *emphasized*

- parent
  1. nested

- [x] finished
- [ ] pending

~~removed~~ and \`inline\`

\`\`\`ts
const answer = true;
\`\`\`

| Name | Value |
| --- | ---: |
| A | 1 |`);

    expect(root.querySelector("h1")?.textContent).toBe("Heading");
    expect(root.querySelector("p")?.querySelector("br")).toBeNull();
    expect(root.querySelector("blockquote strong")?.textContent).toBe("strong");
    expect(root.querySelector("blockquote em")?.textContent).toBe("emphasized");
    expect(root.querySelector("ul ol li")?.textContent).toContain("nested");
    expect(root.querySelectorAll("input.task-list-item-checkbox")).toHaveLength(2);
    expect(
      root.querySelector<HTMLInputElement>("input.task-list-item-checkbox")
        ?.disabled,
    ).toBe(true);
    expect(root.querySelector("s")?.textContent).toBe("removed");
    expect(root.querySelector("code")?.textContent).toBe("inline");
    expect(root.querySelector("pre code")?.textContent).toContain(
      "const answer = true;",
    );
    expect(root.querySelector(".markdown-table-scroll > table")).not.toBeNull();
  });

  it("uses standard soft breaks and preserves explicit hard breaks", () => {
    const root = render("soft\nbreak\n\nhard  \nbreak\\\nagain");
    const paragraphs = root.querySelectorAll("p");

    expect(paragraphs).toHaveLength(2);
    expect(paragraphs[0].querySelector("br")).toBeNull();
    expect(paragraphs[1].querySelectorAll("br")).toHaveLength(2);
  });

  it("escapes raw HTML and never creates remote images", () => {
    const root = render(
      '<script>window.bad = true</script>\n\n![diagram](https://example.com/a.png "title")',
    );

    expect(root.querySelector("script")).toBeNull();
    expect(root.textContent).toContain("<script>window.bad = true</script>");
    expect(root.querySelector("img")).toBeNull();
    expect(root.querySelector(".markdown-image-placeholder")?.textContent).toBe(
      "[图片：diagram]",
    );
  });

  it("copies only HTTP links without navigating", () => {
    const copied = vi.fn();
    const root = renderMarkdown(
      "[web](https://example.com/path?q=1) [relative](/help) [mail](mailto:user@example.com) https://openai.com",
      copied,
    );
    const links = root.querySelectorAll<HTMLButtonElement>("button.markdown-link");

    expect(links).toHaveLength(2);
    expect(root.querySelector("a")).toBeNull();
    expect(root.textContent).toContain("relative");
    expect(root.textContent).toContain("mail");

    links[0].click();
    links[0].dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
    );
    links[1].dispatchEvent(
      new KeyboardEvent("keydown", { key: " ", bubbles: true }),
    );

    expect(copied).toHaveBeenNthCalledWith(
      1,
      "https://example.com/path?q=1",
    );
    expect(copied).toHaveBeenNthCalledWith(
      2,
      "https://example.com/path?q=1",
    );
    expect(copied).toHaveBeenNthCalledWith(3, "https://openai.com");
  });

  it("does not make dangerous schemes interactive", () => {
    const copied = vi.fn();
    const root = renderMarkdown(
      "[bad](javascript:alert(1)) [file](file:///tmp/a)",
      copied,
    );

    expect(root.querySelector("a, button.markdown-link")).toBeNull();
    expect(copied).not.toHaveBeenCalled();
  });
});

import MarkdownIt from "markdown-it";
import taskLists from "markdown-it-task-lists";

export type CopyLinkHandler = (url: string) => void | Promise<void>;

const markdown = new MarkdownIt({
  html: false,
  breaks: false,
  linkify: true,
  typographer: false,
}).use(taskLists, { enabled: false });

markdown.renderer.rules.image = (tokens, index, options, env, renderer) => {
  const token = tokens[index];
  const alt = renderer
    .renderInlineAsText(token.children ?? [], options, env)
    .trim();
  const label = alt ? `图片：${alt}` : "图片";
  return `<span class="markdown-image-placeholder">[${markdown.utils.escapeHtml(label)}]</span>`;
};

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function invokeCopy(handler: CopyLinkHandler, url: string): void {
  try {
    void Promise.resolve(handler(url)).catch(() => undefined);
  } catch {
    // The caller owns user-facing error reporting.
  }
}

function replaceLinks(root: HTMLElement, onCopyLink: CopyLinkHandler): void {
  for (const anchor of root.querySelectorAll<HTMLAnchorElement>("a")) {
    const href = anchor.getAttribute("href") ?? "";
    if (!isHttpUrl(href)) {
      anchor.replaceWith(...anchor.childNodes);
      continue;
    }

    const button = document.createElement("button");
    button.type = "button";
    button.className = "markdown-link";
    button.dataset.url = href;
    button.title = `Copy link: ${href}`;
    button.setAttribute(
      "aria-label",
      `Copy link: ${anchor.textContent?.trim() || href}`,
    );
    button.append(...anchor.childNodes);
    button.addEventListener("click", () => invokeCopy(onCopyLink, href));
    button.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      invokeCopy(onCopyLink, href);
    });
    anchor.replaceWith(button);
  }
}

function wrapTables(root: HTMLElement): void {
  for (const table of root.querySelectorAll("table")) {
    const wrapper = document.createElement("div");
    wrapper.className = "markdown-table-scroll";
    wrapper.tabIndex = 0;
    wrapper.setAttribute("role", "region");
    wrapper.setAttribute("aria-label", "Scrollable table");
    table.replaceWith(wrapper);
    wrapper.append(table);
  }
}

export function renderMarkdown(
  raw: string,
  onCopyLink: CopyLinkHandler,
): HTMLElement {
  const root = document.createElement("div");
  root.className = "markdown";
  root.innerHTML = markdown.render(raw);
  replaceLinks(root, onCopyLink);
  wrapTables(root);
  return root;
}

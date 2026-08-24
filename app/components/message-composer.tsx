'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { Link as LinkIcon } from 'lucide-react';

import {
  adaptHrefInput,
  composerHtmlToTemplate,
  filterTemplateTokenSuggestions,
  MESSAGE_TEMPLATE_TOKEN_LIST,
  MESSAGE_TEMPLATE_TOKENS,
  parseMessageTemplate,
  parseSubjectTemplate,
  previewMessageTemplates,
  sanitizeHref,
  templateToChipText,
  templateToComposerHtml,
  unmatchedOpenBracketIndex,
  type MessageTemplateToken,
} from '@/lib/drafting/message-template';

type ComposerMode = 'template' | 'filled';

type Props = {
  subject: string;
  body: string;
  includeSignature: boolean;
  onSubjectChange: (canonical: string) => void;
  onBodyChange: (canonical: string) => void;
  onIncludeSignatureChange?: (value: boolean) => void;
  mode?: ComposerMode;
  signatureHtml?: string;
  compact?: boolean;
  disabled?: boolean;
};

type LinkDraft = {
  text: string;
  href: string;
  top: number;
  left: number;
  collapsed: boolean;
};

function currentRange(): Range | null {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) return null;
  return selection.getRangeAt(0);
}

function consumeTypedOpenBracket(range: Range) {
  let node: Node = range.startContainer;
  let offset = range.startOffset;
  if (node.nodeType === Node.ELEMENT_NODE) {
    const child = node.childNodes[Math.max(0, offset - 1)] ?? node.childNodes[offset];
    if (!child || child.nodeType !== Node.TEXT_NODE) return;
    node = child;
    offset = child.textContent?.length ?? 0;
  }
  if (node.nodeType !== Node.TEXT_NODE) return;
  const text = node.textContent ?? '';
  const index = unmatchedOpenBracketIndex(text.slice(0, offset));
  if (index < 0) return;
  range.setStart(node, index);
}

function insertHtmlAtCursor(html: string, consumeOpenBracket = false) {
  const range = currentRange();
  if (!range) return;
  if (consumeOpenBracket) consumeTypedOpenBracket(range);
  range.deleteContents();
  const fragment = range.createContextualFragment(html);
  const last = fragment.lastChild;
  range.insertNode(fragment);
  if (last) {
    range.setStartAfter(last);
    range.collapse(true);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
  }
}

function rangeInside(root: HTMLElement, range: Range): boolean {
  return root.contains(range.commonAncestorContainer);
}

function existingAnchor(root: HTMLElement, range: Range): HTMLAnchorElement | null {
  const node = range.commonAncestorContainer;
  const el = node instanceof Element ? node : node.parentElement;
  const anchor = el?.closest('a');
  return anchor instanceof HTMLAnchorElement && root.contains(anchor) ? anchor : null;
}

export function MessageComposer({
  subject,
  body,
  includeSignature,
  onSubjectChange,
  onBodyChange,
  onIncludeSignatureChange,
  mode = 'template',
  signatureHtml,
  compact = false,
  disabled = false,
}: Props) {
  const bodyWrapRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const subjectRef = useRef<HTMLInputElement>(null);
  const linkUrlRef = useRef<HTMLInputElement>(null);
  const savedRangeRef = useRef<Range | null>(null);
  const savedAnchorRef = useRef<HTMLAnchorElement | null>(null);
  const focusedRef = useRef<'subject' | 'body' | null>(null);
  const [subjectDisplay, setSubjectDisplay] = useState(() => templateToChipText(subject));
  const [tokenMenu, setTokenMenu] = useState<{
    query: string;
    for: 'subject' | 'body';
  } | null>(null);
  const [linkDraft, setLinkDraft] = useState<LinkDraft | null>(null);
  const [linkError, setLinkError] = useState<string | null>(null);

  useEffect(() => {
    if (focusedRef.current === 'subject') return;
    setSubjectDisplay(templateToChipText(subject));
  }, [subject]);

  useEffect(() => {
    const el = bodyRef.current;
    if (!el || focusedRef.current === 'body') return;
    const next = templateToComposerHtml(body);
    if (el.innerHTML !== next) el.innerHTML = next;
  }, [body]);

  const linkOpen = Boolean(linkDraft);
  useEffect(() => {
    if (!linkOpen) return;
    linkUrlRef.current?.focus();
    linkUrlRef.current?.select();
  }, [linkOpen]);

  const subjectParsed = useMemo(() => parseSubjectTemplate(subjectDisplay), [subjectDisplay]);
  const bodyParsed = useMemo(() => parseMessageTemplate(body, { allowEmpty: true }), [body]);
  const errors = mode === 'template'
    ? [...subjectParsed.errors, ...bodyParsed.errors]
    : bodyParsed.errors.filter((error) => error.code === 'invalid_link');

  const preview = useMemo(
    () => previewMessageTemplates({ subjectTemplate: subject, bodyTemplate: body }),
    [subject, body],
  );

  const suggestions = tokenMenu
    ? filterTemplateTokenSuggestions(tokenMenu.query)
    : MESSAGE_TEMPLATE_TOKEN_LIST;

  const emitBody = useCallback(() => {
    const html = bodyRef.current?.innerHTML ?? '';
    onBodyChange(composerHtmlToTemplate(html));
  }, [onBodyChange]);

  function closeLinkEditor() {
    savedRangeRef.current = null;
    savedAnchorRef.current = null;
    setLinkDraft(null);
    setLinkError(null);
  }

  function insertToken(token: MessageTemplateToken) {
    closeLinkEditor();
    const chip = `[${MESSAGE_TEMPLATE_TOKENS[token].label}]`;
    const target = tokenMenu?.for ?? focusedRef.current ?? 'body';
    if (target === 'subject') {
      const input = subjectRef.current;
      const start = input?.selectionStart ?? subjectDisplay.length;
      const end = input?.selectionEnd ?? start;
      const open = unmatchedOpenBracketIndex(subjectDisplay.slice(0, start));
      const from = open >= 0 ? open : start;
      const next = `${subjectDisplay.slice(0, from)}${chip}${subjectDisplay.slice(end)}`;
      setSubjectDisplay(next);
      onSubjectChange(parseSubjectTemplate(next).canonical);
      setTokenMenu(null);
      window.setTimeout(() => {
        const cursor = from + chip.length;
        input?.setSelectionRange(cursor, cursor);
        input?.focus();
      }, 0);
      return;
    }
    insertHtmlAtCursor(
      `<span class="message-var" data-token="${token}" contenteditable="false">${chip}</span>&nbsp;`,
      true,
    );
    emitBody();
    setTokenMenu(null);
    bodyRef.current?.focus();
  }

  function bodyRangeForLink(): Range | null {
    const bodyEl = bodyRef.current;
    if (!bodyEl) return null;
    const selection = window.getSelection();
    if (selection && selection.rangeCount > 0) {
      const range = selection.getRangeAt(0);
      if (rangeInside(bodyEl, range)) return range.cloneRange();
    }
    bodyEl.focus();
    const range = document.createRange();
    range.selectNodeContents(bodyEl);
    range.collapse(false);
    selection?.removeAllRanges();
    selection?.addRange(range);
    return range.cloneRange();
  }

  function openLinkEditor() {
    if (linkDraft) {
      closeLinkEditor();
      bodyRef.current?.focus();
      return;
    }
    setTokenMenu(null);
    setLinkError(null);
    const bodyEl = bodyRef.current;
    const wrap = bodyWrapRef.current;
    if (!bodyEl || !wrap) return;
    const range = bodyRangeForLink();
    if (!range) return;
    savedRangeRef.current = range;
    const anchor = existingAnchor(bodyEl, range);
    savedAnchorRef.current = anchor;
    const rect = (anchor ?? range).getBoundingClientRect();
    const host = wrap.getBoundingClientRect();
    const popWidth = Math.min(360, host.width - 16);
    const left = Math.max(8, Math.min(rect.left - host.left, host.width - popWidth - 8));
    const below = rect.bottom - host.top + 8;
    const top = below + 96 > host.height && rect.top - host.top > 96
      ? Math.max(8, rect.top - host.top - 88)
      : below;
    setLinkDraft({
      text: (anchor?.textContent ?? range.toString()).trim(),
      href: sanitizeHref(anchor?.getAttribute('href') || '') || '',
      top,
      left,
      collapsed: range.collapsed && !anchor,
    });
  }

  function commitLink() {
    if (!linkDraft) return;
    const href = sanitizeHref(linkDraft.href.trim());
    if (!href) {
      setLinkError('Links must use http or https URLs.');
      return;
    }
    const label = linkDraft.text.trim() || href.replace(/^https?:\/\//, '');
    const bodyEl = bodyRef.current;
    const range = savedRangeRef.current;
    if (!bodyEl || !range) return;

    const existing = savedAnchorRef.current;
    if (existing && bodyEl.contains(existing)) {
      existing.setAttribute('href', href);
      if (label && existing.textContent !== label) existing.textContent = label;
    } else {
      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
      if (range.collapsed) {
        const a = document.createElement('a');
        a.setAttribute('href', href);
        a.textContent = label;
        range.insertNode(a);
        range.setStartAfter(a);
        range.collapse(true);
      } else {
        const a = document.createElement('a');
        a.setAttribute('href', href);
        a.appendChild(range.extractContents());
        range.insertNode(a);
        range.setStartAfter(a);
        range.collapse(true);
      }
      selection?.removeAllRanges();
      selection?.addRange(range);
    }
    emitBody();
    closeLinkEditor();
    bodyEl.focus();
  }

  function onSubjectInput(value: string) {
    setSubjectDisplay(value);
    onSubjectChange(parseSubjectTemplate(value).canonical);
    const cursor = subjectRef.current?.selectionStart ?? value.length;
    const before = value.slice(0, cursor);
    const open = unmatchedOpenBracketIndex(before);
    if (open >= 0) {
      setTokenMenu({ query: before.slice(open + 1), for: 'subject' });
    } else {
      setTokenMenu((current) => (current?.for === 'subject' ? null : current));
    }
  }

  function onBodyInput() {
    emitBody();
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) return;
    const text = selection.anchorNode?.textContent ?? '';
    const offset = selection.anchorOffset;
    const before = text.slice(0, offset);
    const open = unmatchedOpenBracketIndex(before);
    if (open >= 0) {
      setTokenMenu({ query: before.slice(open + 1), for: 'body' });
    } else {
      setTokenMenu((current) => (current?.for === 'body' ? null : current));
    }
  }

  function onBodyKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === 'Escape') {
      if (linkDraft) {
        event.preventDefault();
        closeLinkEditor();
        return;
      }
      setTokenMenu(null);
      return;
    }
    if (tokenMenu && (event.key === 'Enter' || event.key === 'Tab') && suggestions[0]) {
      event.preventDefault();
      insertToken(suggestions[0]);
    }
  }

  function onLinkFieldKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      closeLinkEditor();
      bodyRef.current?.focus();
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      event.stopPropagation();
      commitLink();
    }
  }

  return (
    <div className={`message-composer${compact ? ' message-composer--compact' : ''}`}>
      <div className="message-composer__toolbar">
        {mode === 'template' ? (
          <div className="message-composer__vars">
            <span className="message-composer__toolbar-label">Insert variable</span>
            {MESSAGE_TEMPLATE_TOKEN_LIST.map((token) => (
              <button
                key={token}
                type="button"
                className="message-var-btn"
                disabled={disabled}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => insertToken(token)}
              >
                {MESSAGE_TEMPLATE_TOKENS[token].label}
              </button>
            ))}
          </div>
        ) : null}
        <button
          type="button"
          className={`btn btn--quiet message-composer__link-btn${linkDraft ? ' message-composer__link-btn--active' : ''}`}
          disabled={disabled}
          aria-expanded={Boolean(linkDraft)}
          aria-controls="message-composer-link-pop"
          onMouseDown={(event) => event.preventDefault()}
          onClick={openLinkEditor}
        >
          <LinkIcon size={14} />
          Insert link
        </button>
      </div>

      <label className="field">
        <span className="field__label">Subject</span>
        <input
          ref={subjectRef}
          className="field__input"
          value={subjectDisplay}
          disabled={disabled}
          placeholder={mode === 'template' ? 'e.g. Quick note for [Company Name]' : ''}
          onFocus={() => {
            focusedRef.current = 'subject';
          }}
          onBlur={() => {
            focusedRef.current = null;
            setTokenMenu((current) => (current?.for === 'subject' ? null : current));
          }}
          onChange={(event) => onSubjectInput(event.target.value)}
          onKeyDown={(event) => {
            if (event.key !== 'Enter') return;
            event.preventDefault();
            if (tokenMenu?.for === 'subject' && suggestions[0]) insertToken(suggestions[0]);
          }}
        />
      </label>

      <div className="field">
        <span className="field__label">Body</span>
        <div ref={bodyWrapRef} className="message-composer__body-wrap">
          <div
            ref={bodyRef}
            className="message-composer__body"
            contentEditable={!disabled}
            role="textbox"
            aria-multiline="true"
            aria-label="Message body"
            data-placeholder={mode === 'template' ? 'Write the email. Type [ to insert a field.' : 'Edit this email.'}
            suppressContentEditableWarning
            onFocus={() => {
              focusedRef.current = 'body';
            }}
            onBlur={() => {
              focusedRef.current = null;
              emitBody();
              setTokenMenu((current) => (current?.for === 'body' ? null : current));
            }}
            onInput={onBodyInput}
            onKeyDown={onBodyKeyDown}
          />
          {linkDraft ? (
            <div
              id="message-composer-link-pop"
              className="message-composer__link-pop"
              style={{ top: linkDraft.top, left: linkDraft.left }}
              role="group"
              aria-label="Insert link"
            >
              {linkDraft.collapsed ? (
                <label className="message-composer__link-field">
                  <span className="field__label">Text</span>
                  <input
                    className="field__input"
                    value={linkDraft.text}
                    placeholder="Link text"
                    onChange={(event) => setLinkDraft({ ...linkDraft, text: event.target.value })}
                    onKeyDown={onLinkFieldKeyDown}
                  />
                </label>
              ) : null}
              <label className="message-composer__link-field">
                <span className="field__label">URL</span>
                <input
                  ref={linkUrlRef}
                  className="field__input"
                  value={linkDraft.href}
                  placeholder="calendly.com/… or https://"
                  inputMode="url"
                  autoComplete="off"
                  onPaste={(event) => {
                    const pasted = event.clipboardData.getData('text').trim();
                    if (!pasted) return;
                    event.preventDefault();
                    setLinkError(null);
                    setLinkDraft({ ...linkDraft, href: adaptHrefInput(pasted) || pasted });
                  }}
                  onChange={(event) => {
                    setLinkError(null);
                    setLinkDraft({ ...linkDraft, href: adaptHrefInput(event.target.value) });
                  }}
                  onKeyDown={onLinkFieldKeyDown}
                />
              </label>
              <div className="message-composer__link-actions">
                <button type="button" className="btn btn--quiet" onClick={() => {
                  closeLinkEditor();
                  bodyRef.current?.focus();
                }}>
                  Cancel
                </button>
                <button type="button" className="btn btn--primary message-composer__link-apply" onClick={commitLink}>
                  Apply
                </button>
              </div>
            </div>
          ) : null}
        </div>
      </div>

      {tokenMenu && mode === 'template' && suggestions.length > 0 ? (
        <ul className="message-composer__suggest" role="listbox">
          {suggestions.map((token) => (
            <li key={token}>
              <button
                type="button"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => insertToken(token)}
              >
                {MESSAGE_TEMPLATE_TOKENS[token].label}
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      {linkError ? <p className="field__hint" role="alert">{linkError}</p> : null}
      {errors.length > 0 ? (
        <p className="field__hint" role="alert">{errors[0]!.message}</p>
      ) : null}

      {onIncludeSignatureChange ? (
        <div className="field">
          <span className="field__label">Signature</span>
          <div className="segmented" style={{ width: 'fit-content' }}>
            <button
              type="button"
              className={`segmented__item${includeSignature ? ' segmented__item--active' : ''}`}
              disabled={disabled}
              onClick={() => onIncludeSignatureChange(true)}
            >
              Include
            </button>
            <button
              type="button"
              className={`segmented__item${!includeSignature ? ' segmented__item--active' : ''}`}
              disabled={disabled}
              onClick={() => onIncludeSignatureChange(false)}
            >
              Off
            </button>
          </div>
          <p className="field__hint" style={{ margin: 0, marginTop: 'var(--space-1)' }}>
            {includeSignature
              ? 'The Helios signature is added at send. Don’t type a second one.'
              : 'Send the body only. You can type a text sign-off in the message.'}
          </p>
        </div>
      ) : null}

      {mode === 'template' && !compact ? (
        <div className="message-composer__preview">
          <span className="field__label">Preview</span>
          <div className="message-composer__preview-subject">{preview.subject || 'Subject preview'}</div>
          <div
            className="message-composer__preview-body"
            dangerouslySetInnerHTML={{
              __html: `${preview.bodyHtml || '<p class="text-muted">Body preview</p>'}${
                includeSignature && signatureHtml ? signatureHtml : ''
              }`,
            }}
          />
        </div>
      ) : includeSignature && signatureHtml ? (
        <div
          className="message-composer__signature"
          dangerouslySetInnerHTML={{ __html: signatureHtml }}
        />
      ) : null}
    </div>
  );
}

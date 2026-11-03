    // >>> NEXUS-RU-V5 BEGIN
    // Russian UI translation v5. Exact strings come from dictionary.ru.json, dynamic strings from dictionary.patterns.ru.json.
    // The renderer is a real function (serialized with toString), so regex escapes are NOT eaten by a template literal (the v4 bug).
    const nexusRuRenderer = function (DICT, PAT) {
        if (window.__NEXUS_RU_V5__) return;
        window.__NEXUS_RU_V5__ = true;
        window.__ANTIGRAVITY_RU_V5__ = true;
        PAT = PAT || {};
        const norm = (s) => String(s).replace(/[\u00a0\u202f\u2009]/g, ' ').replace(/\s+/g, ' ').trim();

        // ---------- dictionary ----------
        const dict = new Map();
        for (const k of Object.keys(DICT || {})) {
            const v = DICT[k];
            if (typeof v !== 'string' || !v) continue;
            dict.set(norm(k), v);
        }
        const exactProse = new Set((PAT.activityExact || []).map(norm));
        const placeholders = new Set((PAT.placeholders || []).map(norm));

        const lookup = (key) => {
            let v = dict.get(key);
            if (v !== undefined) return v;
            const m = /^(.*?)(\s*(?::|\.\.\.|\u2026))$/.exec(key);
            if (m && m[1]) { v = dict.get(m[1]); if (v !== undefined) return v + m[2]; }
            return undefined;
        };

        // ---------- plural / templates ----------
        const plural = (x, one, few, many) => {
            let n = Math.abs(parseInt(String(x).replace(/\D/g, ''), 10) || 0);
            const n10 = n % 10, n100 = n % 100;
            if (n10 === 1 && n100 !== 11) return one;
            if (n10 >= 2 && n10 <= 4 && (n100 < 12 || n100 > 14)) return few;
            return many;
        };
        const fill = (tpl, m) => tpl.replace(/\{p:(\d+)\|([^|}]*)\|([^|}]*)\|([^}]*)\}|\{t:(\d+)\}|\$(\d)/g,
            (all, pi, a, b, c, ti, di) => {
                if (pi !== undefined) return plural(m[pi], a, b, c);
                if (ti !== undefined) { const s = m[ti] === undefined ? '' : m[ti]; const t = lookup(norm(s)); return t === undefined ? s : t; }
                return m[di] === undefined ? '' : m[di];
            });

        // ---------- rules ----------
        const rules = [];
        for (const r of (PAT.rules || [])) {
            try {
                rules.push({
                    re: new RegExp(r.re, r.flags || ''), to: r.to, scope: r.scope || 'ui',
                    maxLen: r.maxLen || 0, deny: r.deny ? new RegExp(r.deny, 'i') : null,
                    noSentence: !!r.noSentence, requireDict: r.requireDict || null
                });
            } catch (e) { console.warn('[NEXUS RU] bad rule', r.re, e); }
        }
        const applyRules = (key, ctx) => {
            for (const r of rules) {
                if (r.scope === 'ui') { if (ctx.prose || ctx.soft) continue; }
                else if (r.scope === 'activity') { if (!ctx.activity || ctx.soft) continue; }
                const m = r.re.exec(key);
                if (!m) continue;
                if (r.maxLen && key.length > r.maxLen) continue;
                const g = m[1];
                if (r.deny && g && r.deny.test(g)) continue;
                if (r.noSentence && g && (/[.!?]\s/.test(g) || g.split(' ').length > 8)) continue;
                if (r.requireDict) {
                    let ok = true;
                    for (const i of r.requireDict) if (m[i] === undefined || lookup(norm(m[i])) === undefined) { ok = false; break; }
                    if (!ok) continue;
                }
                return fill(r.to, m);
            }
            return null;
        };

        // ---------- optional summary of long thought text (kept from v4) ----------
        const genericActivitySummary = (key) => {
            if (key.length < 70 || key.length > 900) return null;
            if (!/^[A-Z]/.test(key) || !/[a-z]{3}/.test(key)) return null;
            if (/^(The user|User asks|User wants|The request|This request|The task|This task|Initial assessment|To address|To complete|I need to|We need to|This requires|The goal|Next,|First,|Given the|Since the|Before|After|Current assessment|The current)/i.test(key)) {
                if (/search|scan|inspect|review|workspace|project|file|code|documentation/i.test(key))
                    return 'Агент проверяет контекст проекта, связанные файлы и документацию, чтобы выбрать правильное следующее действие.';
                if (/error|fail|issue|problem|diagnos|debug/i.test(key))
                    return 'Агент анализирует ошибку, сопоставляет состояние системы и готовит безопасный способ проверки или исправления.';
                if (/install|update|change|modify|patch|apply|edit/i.test(key))
                    return 'Агент оценивает необходимые изменения, проверяет риски и готовит безопасное выполнение с возможностью отката.';
                return 'Агент анализирует запрос пользователя и текущий контекст, чтобы определить следующие действия.';
            }
            return null;
        };

        // ---------- context ----------
        const HARD = '.monaco-editor, .cm-editor, .xterm, [data-language]';
        const SOFT = 'pre, code, .font-mono';
        const USER = '[data-testid="user-input-step"], [data-testid="voice-user-message"]';
        const PROSE = '[data-message-content], [data-testid*="message"], article, .prose, .markdown, [class*="markdown-"]';
        const inActivity = (el) => {
            let cur = el;
            for (let i = 0; cur && i < 6; i++, cur = cur.parentElement) {
                const testid = (cur.getAttribute && cur.getAttribute('data-testid') || '').toLowerCase();
                const aria = (cur.getAttribute && cur.getAttribute('aria-label') || '').toLowerCase();
                const cls = typeof cur.className === 'string' ? cur.className.toLowerCase() : '';
                if (/thought|reason|activity|trajectory|tool|command|search|step|execution|progress/.test(testid + ' ' + aria + ' ' + cls)) return true;
            }
            return false;
        };
        const ctxOf = (el) => {
            const c = { user: false, hard: false, soft: false, prose: false, activity: false, editable: false };
            if (!el || el.nodeType !== 1) return c;
            if (el.closest(USER)) { c.user = true; return c; }
            if (el.closest(HARD)) { c.hard = true; return c; }
            if (el.isContentEditable || el.closest('[contenteditable="true"], [contenteditable=""], textarea')) { c.editable = true; return c; }
            c.soft = !!el.closest(SOFT);
            c.prose = !!el.closest(PROSE);
            c.activity = inActivity(el);
            return c;
        };

        // ---------- core ----------
        const seen = new Map();
        const note = (key, ctx) => {
            if (ctx.user || ctx.hard || ctx.editable || ctx.prose || ctx.soft) return;
            if (key.length > 200 || !/[A-Za-z]{2,}/.test(key)) return;
            if (seen.size < 5000) seen.set(key, (seen.get(key) || 0) + 1);
        };
        const translateKey = (key, ctx, attr) => {
            if (ctx.user || ctx.hard) return null;
            if (ctx.editable) return (placeholders.has(key) ? lookup(key) : null) || null;
            let v;
            if (!ctx.soft && (!ctx.prose || exactProse.has(key) || attr)) v = lookup(key);
            if (v === undefined || v === null) v = applyRules(key, ctx);
            if ((v === undefined || v === null) && ctx.activity && !ctx.soft) v = genericActivitySummary(key);
            if (v === undefined || v === null) { note(key, ctx); return null; }
            return v;
        };

        const done = new WeakMap();
        let force = false;
        const doText = (node) => {
            const src = node.nodeValue;
            if (!src || src.length > 1500) return;
            if (!force && done.get(node) === src) return;
            const key = norm(src);
            if (!key) return;
            const parent = node.parentElement;
            if (!parent) return;
            const tag = parent.tagName;
            if (tag === 'SCRIPT' || tag === 'STYLE' || tag === 'NOSCRIPT') return;
            const v = translateKey(key, ctxOf(parent), false);
            if (v && v !== key) {
                const lead = /^\s*/.exec(src)[0], trail = /\s*$/.exec(src)[0];
                const out = lead + v + trail;
                node.nodeValue = out;
                done.set(node, out);
            } else done.set(node, src);
        };
        const ATTRS = ['placeholder', 'aria-label', 'title', 'data-placeholder', 'aria-placeholder', 'alt'];
        const doAttrs = (el) => {
            let ctx = null;
            for (const a of ATTRS) {
                const src = el.getAttribute(a);
                if (!src || src.length > 400) continue;
                const key = norm(src);
                if (!key) continue;
                if (!ctx) ctx = ctxOf(el);
                if (ctx.user || ctx.hard) return;
                let v = lookup(key);
                if (v === undefined) v = applyRules(key, { prose: false, soft: false, activity: false, editable: false });
                if (v === undefined || v === null) { note(key, ctx); continue; }
                if (v !== key) el.setAttribute(a, v);
            }
        };
        const walk = (root) => {
            if (!root) return;
            if (root.nodeType === 3) { doText(root); return; }
            if (root.nodeType !== 1) return;
            if (root.matches && root.matches('script, style')) return;
            doAttrs(root);
            const tw = document.createTreeWalker(root, 1 | 4);
            let n;
            while ((n = tw.nextNode())) {
                if (n.nodeType === 3) doText(n);
                else if (n.nodeType === 1) {
                    if (n.tagName === 'SCRIPT' || n.tagName === 'STYLE') { continue; }
                    doAttrs(n);
                    // contenteditable placeholders rendered as a text node are handled in doText through ctx.editable
                }
            }
        };

        // ---------- scheduling ----------
        const queue = new Set();
        let timer = 0;
        const flush = () => {
            timer = 0;
            const items = Array.from(queue); queue.clear();
            for (const it of items) { try { if (it.isConnected !== false) walk(it); } catch (e) { /* keep going */ } }
        };
        const enqueue = (n) => { queue.add(n); if (!timer) timer = setTimeout(flush, 40); };

        const root = document.documentElement;
        if (root) walk(root);
        const observer = new MutationObserver((muts) => {
            for (const m of muts) {
                if (m.type === 'characterData') enqueue(m.target);
                else if (m.type === 'attributes') enqueue(m.target);
                else for (const n of m.addedNodes) enqueue(n);
            }
        });
        if (root) observer.observe(root, { childList: true, subtree: true, characterData: true, attributes: true,
            attributeFilter: ['placeholder', 'aria-label', 'title', 'data-placeholder', 'aria-placeholder', 'alt'] });

        let pass = 0;
        const refresh = setInterval(() => {
            try {
                if (document.hidden || !document.documentElement) return;
                force = (++pass % 10 === 0);
                walk(document.documentElement);
            } catch (e) { /* ignore */ } finally { force = false; }
        }, 3000);
        window.addEventListener('beforeunload', () => clearInterval(refresh), { once: true });
        window.__ANTIGRAVITY_RU_OBSERVER__ = observer;

        // Debug helpers: window.__NEXUS_RU__.missing() lists English UI strings that were not translated yet.
        window.__NEXUS_RU__ = {
            version: 5, entries: dict.size, rules: rules.length,
            missing: () => Array.from(seen.entries()).sort((a, b) => b[1] - a[1]).map((e) => e[0]),
            run: () => { force = true; try { walk(document.documentElement); } finally { force = false; } },
            test: (s) => { const k = norm(s); return translateKey(k, { prose: false, soft: false, activity: false, user: false, hard: false, editable: false }, false); }
        };
        console.log('[NEXUS RU v5] loaded: ' + dict.size + ' strings, ' + rules.length + ' rules');
    };

    const injectRussianUI = async () => {
        try {
            const fs = require('fs'); const path = require('path');
            const dictionaryPath = path.join(process.resourcesPath, 'dictionary.ru.json');
            if (!fs.existsSync(dictionaryPath))
                return;
            const readJson = (p) => JSON.parse(fs.readFileSync(p, 'utf8').replace(/^\uFEFF/, ''));
            const dictionary = readJson(dictionaryPath);
            let patterns = {};
            const patternsPath = path.join(process.resourcesPath, 'dictionary.patterns.ru.json');
            try { if (fs.existsSync(patternsPath)) patterns = readJson(patternsPath); } catch (e) { console.error('[NEXUS RU v5] patterns file is broken:', e); }
            const script = '(' + nexusRuRenderer.toString() + ')(' + JSON.stringify(dictionary) + ',' + JSON.stringify(patterns) + ');';
            await win.webContents.executeJavaScript(script);
        }
        catch (err) {
            console.error('[NEXUS RU v5] translation injection failed:', err);
        }
    };
    win.webContents.on('did-finish-load', () => {
        void injectRussianUI();
    });
    // <<< NEXUS-RU-V5 END

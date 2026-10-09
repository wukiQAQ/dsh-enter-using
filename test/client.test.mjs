/**
 * Tests for the dsh-enter-using Client module.
 *
 * The module is a `window.__ModuleLoader__.load(...)` factory, so it is loaded
 * here in a `vm` sandbox with a stubbed `window`, `document` and React, then
 * driven the way the DSH Client would drive it: register through a fake
 * `ctx`, render the panel, dispatch keydown events.
 *
 * Run with `npm test`.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

// ---------------------------------------------------------------------------
// Minimal React stand-in: hooks keyed by call order.
//   __reset() keeps hook cells (a re-render), __clear() drops them (a mount).
// ---------------------------------------------------------------------------

function createReact() {
	const cells = [];
	const effects = [];
	let cursor = 0;

	const api = {
		createElement(type, props, ...children) {
			const merged = {};
			let key = null;
			for (const name of Object.keys(props || {})) {
				if (name === "key") key = props[name];
				else merged[name] = props[name];
			}
			if (children.length === 1) merged.children = children[0];
			else if (children.length > 1) merged.children = children;
			const element = { type, props: merged };
			if (key !== null) element.key = key;
			return element;
		},
		useState(initial) {
			const index = cursor++;
			if (cells[index] === undefined) {
				cells[index] = { value: typeof initial === "function" ? initial() : initial };
			}
			const cell = cells[index];
			return [
				cell.value,
				(next) => {
					cell.value = typeof next === "function" ? next(cell.value) : next;
				},
			];
		},
		useRef(initial) {
			const index = cursor++;
			if (cells[index] === undefined) cells[index] = { value: { current: initial } };
			return cells[index].value;
		},
		useEffect(fn) {
			effects.push(fn);
		},
		__reset() {
			cursor = 0;
			effects.length = 0;
		},
		__clear() {
			cells.length = 0;
			cursor = 0;
			effects.length = 0;
		},
		__effects: effects,
	};
	return api;
}

// ---------------------------------------------------------------------------
// DOM stand-in: records listeners so the test can dispatch keydown events.
// ---------------------------------------------------------------------------

function createDocument() {
	const listeners = [];
	const styleTags = [];
	return {
		listeners,
		styleTags,
		modalOpen: false,
		addEventListener(type, fn) {
			listeners.push({ type, fn });
		},
		removeEventListener(type, fn) {
			const index = listeners.findIndex((entry) => entry.type === type && entry.fn === fn);
			if (index >= 0) listeners.splice(index, 1);
		},
		querySelector(selector) {
			if (this.modalOpen && selector.includes("dialog")) return {};
			return null;
		},
		createElement(tagName) {
			return {
				tagName,
				dataset: {},
				textContent: "",
				remove() {
					const index = styleTags.indexOf(this);
					if (index >= 0) styleTags.splice(index, 1);
				},
			};
		},
		head: {
			appendChild(node) {
				styleTags.push(node);
				return node;
			},
		},
	};
}

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

const clientPath = fileURLToPath(new URL("../client.js", import.meta.url));
const source = readFileSync(clientPath, "utf8");

const react = createReact();
const doc = createDocument();
let loaded = null;

const sandbox = {
	window: {
		__ModuleLoader__: {
			load(definition) {
				loaded = definition;
			},
		},
	},
	document: doc,
	require(id) {
		if (id === "react") return react;
		throw new Error("unexpected require: " + id);
	},
	console,
};
sandbox.globalThis = sandbox;
vm.runInNewContext(source, sandbox, { filename: clientPath });

assert.ok(loaded !== null, "client.js must call window.__ModuleLoader__.load");
assert.equal(loaded.id, "dsh-enter-using");
assert.equal(typeof loaded.factory, "function");

const mod = loaded.factory(sandbox.require);
const T = mod.__test;

/** Translate with variable interpolation, enough to expose the wiring. */
const t = (key, vars) => (vars === undefined ? key : key + JSON.stringify(vars));

let cleanups = [];

function mountEffects() {
	for (const effect of react.__effects) {
		const cleanup = effect();
		if (typeof cleanup === "function") cleanups.push(cleanup);
	}
}

/** First render of a freshly mounted component. */
function mount(props) {
	react.__clear();
	return renderOnce(props);
}

/** Re-render an already mounted component (hook state survives). */
function rerender(props) {
	return renderOnce(props);
}

function renderOnce(props) {
	for (const cleanup of cleanups.splice(0)) cleanup();
	react.__reset();
	const tree = T.ApprovalFlow(props);
	mountEffects();
	return tree;
}

function unmount() {
	for (const cleanup of cleanups.splice(0)) cleanup();
}

/** Dispatch a keydown the way the browser would deliver it. */
function press(key, extra = {}) {
	const event = Object.assign(
		{
			key,
			code: undefined,
			ctrlKey: false,
			metaKey: false,
			altKey: false,
			shiftKey: false,
			repeat: false,
			isComposing: false,
			keyCode: 0,
			defaultPrevented: false,
			target: { closest: () => null },
			preventDefault() {
				this.defaultPrevented = true;
			},
			stopPropagation() {
				this.propagationStopped = true;
			},
		},
		extra,
	);
	for (const listener of doc.listeners.slice()) listener.fn(event);
	return event;
}

function makeApproval(overrides = {}) {
	return Object.assign(
		{
			kind: "approval",
			key: "approval:7",
			toolName: "pwsh",
			callId: "call-1",
			reason: "raw-reason",
			answerable: true,
			calls: [],
			answer(outcome) {
				this.calls.push(outcome);
				return Promise.resolve();
			},
		},
		overrides,
	);
}

function flowProps(approval) {
	return { approval, headline: "Run pwsh", detail: null, t };
}

function buttonList(tree) {
	const card = tree.props.children;
	const actions = card.props.children[2];
	return actions.props.children;
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

const results = [];
async function check(name, fn) {
	try {
		await fn();
		results.push({ name, ok: true });
	} catch (error) {
		results.push({ name, ok: false, error });
	}
}

// ---------------------------------------------------------------------------
// Module shape and registration
// ---------------------------------------------------------------------------

const effects = [];
const dictionaries = [];
let injected = null;
let registeredSlot = null;
const fakeCtx = {
	effect(fn, label) {
		effects.push({ fn, label });
	},
	locale: {
		register(ns, dicts) {
			dictionaries.push({ ns, dicts });
			return () => {};
		},
		resolveText(text) {
			return "resolved:" + text;
		},
	},
	slots: {
		inject(key, callback) {
			injected = { key, callback };
		},
		register(options, component) {
			registeredSlot = { options, component };
			return () => {};
		},
	},
};

await check("module exposes inject and apply", () => {
	assert.deepEqual(Array.from(mod.inject), ["slots", "locale"]);
	assert.equal(typeof mod.apply, "function");
});

await check("apply registers a dictionary, a stylesheet and one slot injection", () => {
	effects.length = 0;
	dictionaries.length = 0;
	injected = null;
	registeredSlot = null;
	mod.apply(fakeCtx);
	assert.equal(effects.length, 2);
	assert.equal(injected.key, "conversation.composer");
});

await check("dictionary covers both built-in locales with identical keys", () => {
	const dictEffect = effects.find((entry) => String(entry.label).includes("dictionary"));
	const cleanup = dictEffect.fn();
	const dictionary = dictionaries[dictionaries.length - 1];
	assert.equal(dictionary.ns, T.NS);
	assert.deepEqual(Array.from(Object.keys(dictionary.dicts)).sort(), ["en", "zh"]);
	const zhKeys = Array.from(Object.keys(dictionary.dicts.zh)).sort();
	assert.deepEqual(Array.from(Object.keys(dictionary.dicts.en)).sort(), zhKeys);
	for (const key of ["waiting", "allowOnce", "reject", "hint"]) {
		assert.ok(zhKeys.includes(key), "missing dictionary entry: " + key);
	}
	cleanup();
});

await check("stylesheet effect appends and removes one tagged style tag", () => {
	const before = doc.styleTags.length;
	const styleEffect = effects.find((entry) => String(entry.label).includes("styles"));
	assert.ok(styleEffect, "stylesheet effect must be registered");
	const cleanup = styleEffect.fn();
	assert.equal(doc.styleTags.length, before + 1);
	const tag = doc.styleTags[doc.styleTags.length - 1];
	assert.equal(tag.dataset.plugin, "dsh-enter-using");
	assert.equal(tag.dataset.pluginCss, "dsh-enter-using/approval.css");
	assert.ok(tag.textContent.includes(".deu_btn"));
	cleanup();
	assert.equal(doc.styleTags.length, before);
});

await check("the dictionary effect registers through ctx.locale", () => {
	const dictEffect = effects.find((entry) => String(entry.label).includes("dictionary"));
	assert.ok(dictEffect, "dictionary effect must be registered");
	const before = dictionaries.length;
	const cleanup = dictEffect.fn();
	assert.equal(dictionaries.length, before + 1);
	cleanup();
});

await check("slot registration targets the composer chain ahead of the shipped panel", () => {
	injected.callback();
	assert.ok(registeredSlot !== null, "the injection must register a slot occupant");
	const options = registeredSlot.options;
	assert.equal(options.name, "conversation.composer");
	assert.equal(typeof options.select, "function");
	assert.equal(options.locale, T.NS);
	assert.ok(options.priority < 1, "must outrank the shipped approval panel (priority 1)");
	assert.equal(typeof options.inject().resolveReason, "function");
	assert.equal(registeredSlot.component, T.ApprovalKeysPanel);
});

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

await check("selectApproval matches only answerable approvals", () => {
	const approval = makeApproval();
	assert.equal(T.selectApproval({ pendingInteraction: approval }), approval);
	assert.equal(T.selectApproval({ pendingInteraction: null }), null);
	assert.equal(T.selectApproval({ pendingInteraction: { kind: "question" } }), null);
	assert.equal(T.selectApproval({ pendingInteraction: { kind: "approval" } }), null);
	assert.equal(T.selectApproval(undefined), null);
	assert.equal(T.selectApproval({}), null);
});

await check("isApproval rejects look-alikes", () => {
	assert.equal(T.isApproval(makeApproval()), true);
	assert.equal(T.isApproval({ kind: "approval" }), false);
	assert.equal(T.isApproval({ kind: "approval", answer: 1 }), false);
	assert.equal(T.isApproval(null), false);
	assert.equal(T.isApproval("approval"), false);
});

await check("decisionFor maps numbers, Escape, Enter and arrows", () => {
	assert.equal(T.decisionFor({ key: "1", code: "Digit1" }, 0).outcome, T.ALLOW);
	assert.equal(T.decisionFor({ key: "2", code: "Numpad2" }, 0).outcome, T.REJECT);
	assert.equal(T.decisionFor({ key: "Escape" }, 0).outcome, T.REJECT);
	assert.equal(T.decisionFor({ key: "Esc" }, 0).outcome, T.REJECT);
	assert.equal(T.decisionFor({ key: "Enter" }, 0).outcome, T.ALLOW);
	assert.equal(T.decisionFor({ key: "Enter" }, 1).outcome, T.REJECT);
	assert.equal(T.decisionFor({ key: "Enter", code: "NumpadEnter" }, 1).outcome, T.REJECT);
	for (const [key, delta] of [
		["ArrowDown", 1],
		["ArrowRight", 1],
		["ArrowUp", -1],
		["ArrowLeft", -1],
	]) {
		const decision = T.decisionFor({ key }, 0);
		assert.equal(decision.type, "move", key);
		assert.equal(decision.delta, delta, key);
	}
});

await check("decisionFor ignores events that are not ours", () => {
	assert.equal(T.decisionFor({ key: "1", defaultPrevented: true }, 0), null);
	assert.equal(T.decisionFor({ key: "1", ctrlKey: true }, 0), null);
	assert.equal(T.decisionFor({ key: "1", metaKey: true }, 0), null);
	assert.equal(T.decisionFor({ key: "1", altKey: true }, 0), null);
	assert.equal(T.decisionFor({ key: "1", isComposing: true }, 0), null);
	assert.equal(T.decisionFor({ key: "1", nativeEvent: { isComposing: true } }, 0), null);
	assert.equal(T.decisionFor({ key: "1", keyCode: 229 }, 0), null);
	assert.equal(T.decisionFor({ key: "a" }, 0), null);
	assert.equal(T.decisionFor({ key: "Tab" }, 0), null);
	assert.equal(T.decisionFor(null, 0), null);
});

await check("isEditableTarget protects text entry surfaces", () => {
	assert.equal(T.isEditableTarget(null), false);
	assert.equal(T.isEditableTarget({}), false);
	assert.equal(
		T.isEditableTarget({ closest: (selector) => (selector.includes("input") ? {} : null) }),
		true,
	);
	assert.equal(T.isEditableTarget({ closest: () => null }), false);
});

await check("headlineFor resolves the reason and falls back to the escalation text", () => {
	assert.equal(
		T.headlineFor(makeApproval(), { t, resolveReason: (text) => "resolved:" + text }),
		"resolved:raw-reason",
	);
	assert.equal(
		T.headlineFor(makeApproval({ reason: undefined, displayReason: undefined }), { t }),
		'escalation{"toolName":"pwsh"}',
	);
	assert.equal(
		T.headlineFor(makeApproval(), {
			t,
			resolveReason: () => {
				throw new Error("boom");
			},
		}),
		"raw-reason",
	);
});

// ---------------------------------------------------------------------------
// Panel wiring
// ---------------------------------------------------------------------------

await check("ApprovalKeysPanel passes the detail slot through", () => {
	const approval = makeApproval();
	const calls = [];
	const tree = T.ApprovalKeysPanel({
		matched: approval,
		t,
		resolveReason: (text) => "resolved:" + text,
		renderSlot(name, props) {
			calls.push({ name, props });
			return { type: "detail", props };
		},
	});
	assert.equal(tree.type, T.ApprovalFlow);
	assert.equal(tree.key, "approval:7");
	assert.equal(tree.props.headline, "resolved:raw-reason");
	assert.equal(calls.length, 1);
	assert.equal(calls[0].name, "conversation.approval.detail");
	assert.equal(calls[0].props.callId, "call-1");
	assert.equal(tree.props.detail.props.callId, "call-1");
});

await check("ApprovalKeysPanel skips the detail slot without a callId", () => {
	let called = false;
	const tree = T.ApprovalKeysPanel({
		matched: makeApproval({ callId: undefined }),
		t,
		renderSlot() {
			called = true;
			return null;
		},
	});
	assert.equal(called, false);
	assert.equal(tree.props.detail, null);
});

await check("ApprovalKeysPanel declines anything that is not an approval", () => {
	assert.equal(T.ApprovalKeysPanel({ matched: { kind: "question" }, t }), null);
	assert.equal(T.ApprovalKeysPanel({ matched: null, t }), null);
});

// ---------------------------------------------------------------------------
// Interaction
// ---------------------------------------------------------------------------

await check("panel renders numbered allow/reject buttons", () => {
	const tree = mount(flowProps(makeApproval()));
	assert.equal(tree.props.className, "deu_root");
	assert.equal(tree.props["data-approval-key"], "approval:7");
	const buttons = buttonList(tree);
	assert.equal(buttons.length, 2);
	assert.equal(buttons[0].props["data-option"], T.ALLOW);
	assert.equal(buttons[0].props["data-selected"], "true");
	assert.equal(buttons[0].props.children[0].props.children, "1");
	assert.equal(buttons[1].props["data-option"], T.REJECT);
	assert.equal(buttons[1].props.children[0].props.children, "2");
	assert.equal(buttons[0].props.disabled, false);
	unmount();
});

await check("digit 1 allows once and claims the key", () => {
	const approval = makeApproval();
	mount(flowProps(approval));
	const event = press("1", { code: "Digit1" });
	assert.deepEqual(Array.from(approval.calls), [T.ALLOW]);
	assert.equal(event.defaultPrevented, true);
	assert.equal(event.propagationStopped, true);
	unmount();
});

await check("digit 2 and Escape reject", () => {
	for (const key of ["2", "Escape"]) {
		const approval = makeApproval();
		mount(flowProps(approval));
		press(key);
		assert.deepEqual(Array.from(approval.calls), [T.REJECT], "key " + key);
		unmount();
	}
});

await check("Enter confirms the highlighted option", () => {
	const first = makeApproval();
	mount(flowProps(first));
	press("Enter");
	assert.deepEqual(Array.from(first.calls), [T.ALLOW]);
	unmount();

	const second = makeApproval();
	mount(flowProps(second));
	press("ArrowDown");
	rerender(flowProps(second)); // highlight moved
	press("ArrowRight"); // wraps back around to allow-once
	rerender(flowProps(second));
	press("ArrowLeft"); // wraps back to reject
	rerender(flowProps(second));
	press("Enter");
	assert.deepEqual(Array.from(second.calls), [T.REJECT]);
	unmount();
});

await check("an answered panel is disabled and answers only once", () => {
	const approval = makeApproval();
	mount(flowProps(approval));
	press("1");
	const tree = rerender(flowProps(approval));
	const buttons = buttonList(tree);
	assert.equal(tree.props["aria-busy"], "true");
	assert.equal(buttons[0].props.disabled, true);
	assert.equal(buttons[1].props.disabled, true);

	press("2");
	assert.deepEqual(Array.from(approval.calls), [T.ALLOW]);

	// Mouse clicks are guarded the same way.
	buttons[1].props.onClick();
	assert.deepEqual(Array.from(approval.calls), [T.ALLOW]);
	unmount();
});

await check("keys are ignored inside editable surfaces and with modifiers", () => {
	const approval = makeApproval();
	mount(flowProps(approval));
	const editable = press("1", {
		target: { closest: (selector) => (selector.includes("input") ? {} : null) },
	});
	assert.equal(editable.defaultPrevented, false);
	press("1", { ctrlKey: true });
	press("1", { defaultPrevented: true });
	press("a");
	assert.deepEqual(Array.from(approval.calls), []);

	doc.modalOpen = true;
	press("1");
	doc.modalOpen = false;
	assert.deepEqual(Array.from(approval.calls), []);
	unmount();
});

await check("key repeat never double-answers", () => {
	const approval = makeApproval();
	mount(flowProps(approval));
	press("1", { repeat: true });
	assert.deepEqual(Array.from(approval.calls), []);
	press("1");
	assert.deepEqual(Array.from(approval.calls), [T.ALLOW]);
	unmount();
});

await check("an unanswerable approval refuses to answer", () => {
	const approval = makeApproval({ answerable: false });
	mount(flowProps(approval));
	press("1");
	assert.deepEqual(Array.from(approval.calls), []);
	unmount();
});

await check("a failed answer re-enables the panel", async () => {
	const approval = makeApproval({
		answer(outcome) {
			this.calls.push(outcome);
			return Promise.reject(new Error("host refused"));
		},
	});
	mount(flowProps(approval));
	press("1");
	await tick();
	const tree = rerender(flowProps(approval));
	assert.equal(tree.props["aria-busy"], "false");
	assert.equal(buttonList(tree)[0].props.disabled, false);
	unmount();
});

await check("unmount removes the keydown listener", () => {
	const approval = makeApproval();
	mount(flowProps(approval));
	assert.equal(doc.listeners.length, 1);
	unmount();
	assert.equal(doc.listeners.length, 0);
	press("1");
	assert.deepEqual(Array.from(approval.calls), []);
});

await check("mouse hover moves the highlight", () => {
	const approval = makeApproval();
	mount(flowProps(approval));
	const buttons = buttonList(rerender(flowProps(approval)));
	buttons[1].props.onMouseEnter();
	const tree = rerender(flowProps(approval));
	assert.equal(buttonList(tree)[1].props["data-selected"], "true");
	press("Enter");
	assert.deepEqual(Array.from(approval.calls), [T.REJECT]);
	unmount();
});

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------

const failed = results.filter((entry) => !entry.ok);
for (const entry of results) {
	console.log((entry.ok ? "ok   " : "FAIL ") + entry.name);
	if (!entry.ok) console.log("      " + (entry.error && entry.error.stack));
}
console.log("\n" + (results.length - failed.length) + "/" + results.length + " passed");
if (failed.length > 0) process.exitCode = 1;

/**
 * dsh-enter-using — Client half.
 *
 * Codex-style command approval: the pending approval panel answers with
 * Enter and number keys (1 = allow once, 2 = reject), plus arrow keys to move
 * the highlight and Escape to reject.
 *
 * The plugin takes over the `conversation.composer` chain entry for pending
 * approvals by registering at priority 0.5, earlier than the shipped
 * approval panel (priority 1). `select` matches only answerable approval
 * presentations, so every other pending interaction still falls through to
 * the owner's own panels.
 */

window.__ModuleLoader__.load({
	id: "dsh-enter-using",

	factory(require) {
		const React = require("react");
		const h = React.createElement;

		/** Locale namespace owned by this plugin. */
		const NS = "enterUsing";
		/** Chain priority: lower wins, so 0.5 beats the shipped panel at 1. */
		const PRIORITY = 0.5;
		const ALLOW = "allowed-once";
		const REJECT = "rejected";

		const zh = {
			waiting: "等待授权",
			"detail.aria": "命令授权详情",
			escalation: "工具 {toolName} 请求越权执行",
			allowOnce: "允许一次",
			reject: "拒绝",
			hint: "数字键或方向键选择，Enter 确认，Esc 拒绝",
			"option.aria": "{label}（按 {key}）",
		};

		const en = {
			waiting: "Waiting for approval",
			"detail.aria": "Command approval details",
			escalation: "Tool {toolName} requests privileged execution",
			allowOnce: "Allow once",
			reject: "Reject",
			hint: "Number or arrow keys to choose, Enter to confirm, Esc to reject",
			"option.aria": "{label} (press {key})",
		};

		const CSS = [
			'.deu_root{display:flex;flex-direction:column;align-items:center;box-sizing:border-box;width:100%;padding:8px 16px 12px;outline:none}',
			'.deu_card{display:flex;flex-direction:column;box-sizing:border-box;width:100%;max-width:var(--dsh-chat-content-width,760px);overflow:hidden;border:1px solid var(--dsw-alias-state-warn-secondary,var(--dsw-alias-border-l2));border-radius:var(--dsw-radius-xl,12px);background:var(--dsw-specific-input-major,var(--dsw-alias-bg-layer-1));box-shadow:var(--dsw-shadow-lv2,0 4px 16px rgba(0,0,0,.12))}',
			'.deu_strip{display:flex;align-items:center;gap:8px;flex:none;padding:10px 16px;background:var(--dsw-alias-state-warn-tertiary,transparent);color:var(--dsw-alias-state-warn-primary);font-size:13px;line-height:18px}',
			'.deu_dot{flex:none;width:8px;height:8px;border-radius:50%;background:currentColor}',
			'.deu_body{display:flex;flex-direction:column;gap:6px;box-sizing:border-box;max-height:var(--dsh-composer-text-max-height,240px);padding:12px 16px 0;overflow-y:auto;outline:none}',
			'.deu_headline{color:var(--dsw-alias-label-primary);font-size:15px;font-weight:500;line-height:24px}',
			'.deu_command{color:var(--dsw-alias-label-tertiary);font-family:var(--ds-font-family-code,ui-monospace,SFMono-Regular,Menlo,monospace);font-size:13px;line-height:20px;word-break:break-all;white-space:pre-wrap}',
			'.deu_hint{color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px}',
			'.deu_actions{display:flex;flex:none;justify-content:flex-start;gap:8px;padding:14px 16px}',
			'.deu_btn{display:inline-flex;align-items:center;gap:8px;height:32px;padding:0 14px;border:1px solid var(--dsw-alias-border-l2);border-radius:var(--dsw-radius-lg,8px);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font:inherit;font-size:14px;line-height:20px;cursor:pointer;transition:background-color .12s ease}',
			'.deu_btn:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover,var(--dsw-alias-bg-layer-2))}',
			'.deu_btn[data-variant="primary"]{border-color:transparent;background:var(--dsw-alias-button-primary-fill,var(--dsw-alias-brand-primary));color:var(--dsw-alias-brand-text,#fff)}',
			'.deu_btn[data-variant="primary"]:hover:not(:disabled){background:var(--dsw-alias-button-primary-hover,var(--dsw-alias-brand-primary))}',
			'.deu_btn[data-selected="true"],.deu_btn:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:2px}',
			'.deu_btn:disabled{opacity:.55;cursor:default}',
			'.deu_key{display:inline-flex;align-items:center;justify-content:center;box-sizing:border-box;min-width:18px;height:18px;padding:0 4px;border:1px solid currentColor;border-radius:4px;font-family:var(--ds-font-family-code,monospace);font-size:11px;line-height:1;opacity:.75}',
		].join("");

		/** Options offered for one pending approval, in display order. */
		const OPTIONS = [
			{ key: "1", outcome: ALLOW, label: "allowOnce", variant: "primary" },
			{ key: "2", outcome: REJECT, label: "reject", variant: "outline" },
		];

		/** True when the event target is a text entry surface we must not hijack. */
		function isEditableTarget(target) {
			if (target === null || target === undefined) return false;
			if (typeof target.closest !== "function") return false;
			return (
				target.closest(
					'input, textarea, select, [contenteditable="true"], [contenteditable=""]',
				) !== null
			);
		}

		/** True while a modal owns the keyboard; the panel must stay out of the way. */
		function hasModal(doc) {
			if (doc === null || doc === undefined || typeof doc.querySelector !== "function") {
				return false;
			}
			return doc.querySelector('[role="dialog"], [aria-modal="true"]') !== null;
		}

		/** True when a value is an answerable approval presentation from the UI. */
		function isApproval(value) {
			return (
				value !== null &&
				typeof value === "object" &&
				value.kind === "approval" &&
				typeof value.answer === "function"
			);
		}

		/**
		 * Map one keyboard event to the intent it expresses.
		 * Pure: reads the event and the highlighted index, touches no state.
		 * Returns null when the event is not ours to handle.
		 */
		function decisionFor(event, selectedIndex) {
			if (event === null || event === undefined) return null;
			if (event.defaultPrevented === true) return null;
			if (event.ctrlKey || event.metaKey || event.altKey) return null;
			if (event.isComposing === true) return null;
			if (event.nativeEvent && event.nativeEvent.isComposing === true) return null;
			if (event.keyCode === 229) return null;

			const key = event.key;
			const code = event.code;

			if (key === "1" || code === "Digit1" || code === "Numpad1") {
				return { type: "answer", outcome: ALLOW };
			}
			if (key === "2" || code === "Digit2" || code === "Numpad2") {
				return { type: "answer", outcome: REJECT };
			}
			if (key === "Escape" || key === "Esc") {
				return { type: "answer", outcome: REJECT };
			}
			if (key === "ArrowDown" || key === "ArrowRight") {
				return { type: "move", delta: 1 };
			}
			if (key === "ArrowUp" || key === "ArrowLeft") {
				return { type: "move", delta: -1 };
			}
			if (key === "Enter" || code === "NumpadEnter") {
				const option = OPTIONS[selectedIndex];
				return { type: "answer", outcome: option === undefined ? ALLOW : option.outcome };
			}
			return null;
		}

		/** Resolve the headline text, falling back to the escalation message. */
		function headlineFor(approval, props) {
			const raw =
				approval.displayReason === undefined ? approval.reason : approval.displayReason;
			if (raw === undefined || raw === null || raw === "") {
				return props.t("escalation", { toolName: approval.toolName });
			}
			if (typeof props.resolveReason !== "function") return raw;
			try {
				const resolved = props.resolveReason(raw);
				return resolved === undefined || resolved === null || resolved === "" ? raw : resolved;
			} catch (_error) {
				return raw;
			}
		}

		/**
		 * Renders the pending approval with keyboard-first options.
		 * Holds no state itself so that a new approval (new key) remounts the flow.
		 */
		function ApprovalKeysPanel(props) {
			const approval = props.matched;
			if (!isApproval(approval)) return null;

			let detail = null;
			if (typeof props.renderSlot === "function" && approval.callId !== undefined) {
				detail = props.renderSlot("conversation.approval.detail", { callId: approval.callId });
			}

			return h(
				ApprovalFlow,
				{
					key: approval.key === undefined ? "approval" : approval.key,
					approval,
					headline: headlineFor(approval, props),
					detail,
					t: props.t,
				},
				null,
			);
		}

		/** Stateful approval flow: submits exactly one answer, guarded on unmount. */
		function ApprovalFlow(props) {
			const approval = props.approval;
			const t = props.t;
			const [answered, setAnswered] = React.useState(false);
			const [selected, setSelected] = React.useState(0);
			const waiting = React.useRef(false);
			const mounted = React.useRef(true);
			const selectedRef = React.useRef(0);
			const answerRef = React.useRef(null);

			selectedRef.current = selected;

			React.useEffect(function () {
				mounted.current = true;
				return function () {
					mounted.current = false;
				};
			}, []);

			function answer(outcome) {
				if (waiting.current) return;
				if (approval.answerable === false) return;
				waiting.current = true;
				setAnswered(true);
				let result;
				try {
					result = approval.answer(outcome);
				} catch (error) {
					result = Promise.reject(error);
				}
				Promise.resolve(result).catch(function () {
					if (!mounted.current) return;
					if (approval.answerable === false) return;
					waiting.current = false;
					setAnswered(false);
				});
			}

			answerRef.current = answer;

			React.useEffect(function () {
				if (typeof document === "undefined") return undefined;

				function onKeyDown(event) {
					if (event.defaultPrevented === true) return;
					if (isEditableTarget(event.target)) return;
					if (hasModal(document)) return;

					const decision = decisionFor(event, selectedRef.current);
					if (decision === null) return;

					// Claim the key before anything else reacts to it.
					event.preventDefault();
					event.stopPropagation();

					if (event.repeat === true) return;

					if (decision.type === "move") {
						const count = OPTIONS.length;
						setSelected(function (current) {
							return (current + decision.delta + count) % count;
						});
						return;
					}

					if (answerRef.current !== null) answerRef.current(decision.outcome);
				}

				document.addEventListener("keydown", onKeyDown, true);
				return function () {
					document.removeEventListener("keydown", onKeyDown, true);
				};
			}, []);

			const buttons = OPTIONS.map(function (option, index) {
				const label = t(option.label);
				return h(
					"button",
					{
						key: option.key,
						type: "button",
						className: "deu_btn",
						"data-variant": option.variant,
						"data-selected": index === selected ? "true" : "false",
						"data-option": option.outcome,
						disabled: answered,
						"aria-label": t("option.aria", { label, key: option.key }),
						onClick: function () {
							answer(option.outcome);
						},
						onMouseEnter: function () {
							setSelected(index);
						},
					},
					h("span", { className: "deu_key", "aria-hidden": "true" }, option.key),
					h("span", null, label),
				);
			});

			return h(
				"div",
				{
					className: "deu_root",
					"data-approval-key": approval.key,
					"aria-busy": answered ? "true" : "false",
					role: "group",
					"aria-label": t("detail.aria"),
				},
				h(
					"div",
					{ className: "deu_card" },
					h(
						"div",
						{ className: "deu_strip" },
						h("span", { className: "deu_dot", "aria-hidden": "true" }),
						h("span", null, t("waiting")),
					),
					h(
						"div",
						{
							className: "deu_body",
							"data-approval-scroll": "",
							tabIndex: 0,
							role: "group",
							"aria-label": t("detail.aria"),
						},
						h("div", { className: "deu_headline" }, props.headline),
						props.detail === null
							? null
							: h("div", { className: "deu_command" }, props.detail),
						h("div", { className: "deu_hint" }, t("hint")),
					),
					h("div", { className: "deu_actions" }, buttons),
				),
			);
		}

		/** Match only answerable approvals; everything else falls through. */
		function selectApproval(owner) {
			const pending = owner === null || owner === undefined ? undefined : owner.pendingInteraction;
			return isApproval(pending) ? pending : null;
		}

		/** Inject the panel stylesheet once, scoped to this plugin. */
		function injectStyles(ctx) {
			ctx.effect(function () {
				if (typeof document === "undefined") return undefined;
				const marker = "dsh-enter-using/approval.css";
				if (document.querySelector('style[data-plugin-css="' + marker + '"]') !== null) {
					return undefined;
				}
				const tag = document.createElement("style");
				tag.dataset.plugin = "dsh-enter-using";
				tag.dataset.pluginCss = marker;
				tag.textContent = CSS;
				document.head.appendChild(tag);
				return function () {
					tag.remove();
				};
			}, "dsh-enter-using: approval styles");
		}

		function apply(ctx) {
			ctx.effect(function () {
				return ctx.locale.register(NS, { zh, en });
			}, "dsh-enter-using: dictionary");

			injectStyles(ctx);

			ctx.slots.inject("conversation.composer", function () {
				return ctx.slots.register(
					{
						name: "conversation.composer",
						priority: PRIORITY,
						select: selectApproval,
						locale: NS,
						inject: function () {
							return {
								resolveReason: function (text) {
									return ctx.locale.resolveText(text);
								},
							};
						},
					},
					ApprovalKeysPanel,
				);
			});
		}

		return {
			inject: ["slots", "locale"],
			apply,
			// Exposed for tests only; the module loader ignores unknown fields.
			__test: {
				NS,
				PRIORITY,
				ALLOW,
				REJECT,
				OPTIONS,
				isApproval,
				isEditableTarget,
				decisionFor,
				headlineFor,
				selectApproval,
				ApprovalKeysPanel,
				ApprovalFlow,
				CSS,
			},
		};
	},
});

/**
 * Host half of the dsh-enter-using bundle.
 *
 * The approval keyboard belongs entirely to the Client: it takes over the
 * `conversation.composer` chain entry for pending approvals and renders the
 * numbered, keyboard-driven panel there. No Host-side behavior is registered.
 */

/** Install nothing on the Host; the Client module owns the approval UI. */
export function apply() {}

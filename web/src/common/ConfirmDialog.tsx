// Asks the user to confirm something, in the app's own dialog rather than the browser's.
import { createSignal, onMount, Show } from "solid-js";

interface Request {
  title: string;
  message: string;
  /** The label of the button that goes ahead, e.g. "Discard". */
  confirm: string;
  /** Going ahead loses work: the button is red. */
  danger?: boolean;
  /** Offers a checkbox with this label; if it's ticked when the user goes ahead, `onRemember` is called. */
  remember?: string;
  onRemember?(): void;
  resolve(ok: boolean): void;
}

const [request, setRequest] = createSignal<Request | null>(null);

/** Shows the dialog; resolves to whether the user went ahead. */
export function askConfirm(options: Omit<Request, "resolve">): Promise<boolean> {
  request()?.resolve(false);
  return new Promise((resolve) => setRequest({ ...options, resolve }));
}

/** Where the dialog is shown: mounted once, in the app. */
export function ConfirmHost() {
  return (
    <Show when={request()} keyed>
      {(r) => <ConfirmDialog request={r} />}
    </Show>
  );
}

function ConfirmDialog(props: { request: Request }) {
  let dialog!: HTMLDialogElement;
  let ok = false;
  const [remember, setRemember] = createSignal(false);
  onMount(() => dialog.showModal());

  function close() {
    if (ok && remember()) props.request.onRemember?.();
    props.request.resolve(ok);
    if (request() === props.request) setRequest(null);
  }

  return (
    <dialog ref={dialog} class="dialog confirm-dialog" onClose={close}>
      <form
        method="dialog"
        onSubmit={() => {
          ok = true;
        }}
      >
        <h2>{props.request.title}</h2>
        <p>{props.request.message}</p>
        <Show when={props.request.remember}>
          <label class="row">
            <input type="checkbox" checked={remember()} onChange={(e) => setRemember(e.currentTarget.checked)} />
            {props.request.remember}
          </label>
        </Show>
        <div class="dialog-actions">
          {/* Cancel comes first in the tab order and has focus, so Enter doesn't lose work by accident. */}
          <button type="button" autofocus onClick={() => dialog.close()}>
            Cancel
          </button>
          <button type="submit" class="primary" classList={{ "danger-fill": props.request.danger }}>
            {props.request.confirm}
          </button>
        </div>
      </form>
    </dialog>
  );
}

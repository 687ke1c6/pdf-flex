import { render } from "solid-js/web";
import { App } from "./App";
import { EditorProvider } from "./editor";
import "./styles.css";

render(
  () => (
    <EditorProvider>
      <App />
    </EditorProvider>
  ),
  document.getElementById("root")!,
);

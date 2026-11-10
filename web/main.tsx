import { createRoot } from "react-dom/client";
import ChildApp from "./child/App";
import ParentApp from "./parent/App";

const isParent = location.pathname.startsWith("/parent");
createRoot(document.getElementById("root")!).render(isParent ? <ParentApp /> : <ChildApp />);

import { Api } from "./api.js";
import { loadRules } from "./rules.js";

await loadRules();
window.janggiApi = await Api.create();
window.dispatchEvent(new Event("janggi-ready"));

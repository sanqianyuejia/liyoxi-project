import { defineRegistration } from "../kernel/index.js";
import { supportPiiFields } from "./pii-fields.js";
export const registration = defineRegistration("support", {
  portImplementations: [supportPiiFields],
});

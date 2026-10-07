import { defineRegistration, implementKeyed } from "../kernel/index.js";
import { DramaPricePort } from "./ports.js";
import { contentMachine } from "./machines.js";
import { contentFileRefs } from "./file-refs.js";
import { contentInvariants } from "./invariants.js";
export const registration = defineRegistration("content", {
  ports: [DramaPricePort],
  portImplementations: [
    implementKeyed(dictReferencesPort, "content", contentDictReferences),
    contentMachine,
    ...contentFileRefs,
  ],
  invariants: contentInvariants,
});

import { dictReferencesPort } from "../kernel/index.js";
import { contentDictReferences } from "./dict-references.js";

// Regenerates examples/suites/*.yaml from the bundled demo suites in @agentlab/core.
import { writeFileSync } from "node:fs";
import YAML from "yaml";
import { PERSONA_SUITE, SUPPORT_SUITE, type SuiteSpec } from "../packages/core/src/index.ts";

function write(file: string, suite: SuiteSpec) {
  const header = `# ${suite.name}\n# Run:  npm run lab -- run examples/suites/${file} --agent sim:support-v2 --trials 8 --min-ri 85\n# Reference: docs/suite-reference.md\n`;
  writeFileSync(`examples/suites/${file}`, header + YAML.stringify(suite, { lineWidth: 0 }));
}
write("support.yaml", SUPPORT_SUITE);
write("persona-gauntlet.yaml", PERSONA_SUITE);
console.log("wrote examples/suites/support.yaml, examples/suites/persona-gauntlet.yaml");

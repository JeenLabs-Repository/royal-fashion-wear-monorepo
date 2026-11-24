// Conventional Commits, plus a rule that rejects plan numbering in commit text.
// Install: npm i -D @commitlint/cli @commitlint/config-conventional
module.exports = {
  extends: ["@commitlint/config-conventional"],
  plugins: [
    {
      rules: {
        "no-plan-references": (parsed) => {
          const text = parsed.raw || "";
          // scope like (1-0) or (01.02), "phase 3", "plan-2", "task 4", "wave 2",
          // requirement ids such as ABC-01 and decision ids such as D-12
          const planNumbering =
            /\(\s*\d+\s*[-.]\s*\d+\s*\)|\b(phase|plan|task)[\s-]?\d+\b|\bwave[\s-]?\d+\b|\b(OPS|CUT|REPO|GOV|VEND|CAT|ROUT|DOC|IND|INT|RET|TEST|NOTF|COMP|INTV2|OPSV2)-\d{1,3}\b|\bD-\d{2}\b/i;
          return [
            !planNumbering.test(text),
            "commit text must not contain plan, phase, task, wave, decision or requirement numbering (for example feat(1-0): or phase 3)",
          ];
        },
      },
    },
  ],
  rules: {
    "no-plan-references": [2, "always"],
    "subject-case": [2, "always", "lower-case"],
    "subject-full-stop": [2, "never", "."],
    "header-max-length": [2, "always", 72],
    "subject-empty": [2, "never"],
    "type-empty": [2, "never"],
  },
};

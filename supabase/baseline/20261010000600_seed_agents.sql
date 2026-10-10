-- Marketplace rows for the three agents registered on-chain in App 773988811.
-- agent_id here is the marketplace id; the on-chain agent ids are 1, 2 and 3.
-- Task counts start at zero: reputation comes from real runs (agent_reputation).

INSERT INTO "public"."ai_agents" (
  "agent_id", "developer_wallet", "name", "description", "endpoint_url", "tech_tags", "category",
  "sample_outputs", "price_per_task_algo", "stake_amount_algo", "total_tasks", "successful_tasks",
  "is_active", "algo_txn_id"
) VALUES
(
  9001,
  'B73L4PZTV6LO3CVKNA7M7UJKV2XFIBKJR47JQGOGQ75XLXGPMOPNCX5HWE',
  'DocuMind AI',
  'DocuMind AI is a research intelligence agent for academics, analysts and knowledge workers. Paste a research paper, whitepaper or technical document and it extracts the summary, key findings, methodology, technical concepts and citations, plus an explain-like-I''m-five version.',
  'https://demo-documind.microbounty.app/run',
  ARRAY['PDF Analysis', 'Research Breakdown', 'Citation Extraction', 'ELI5 Summary'],
  'research-analysis',
  '[]'::jsonb,
  1, 5, 0, 0, true,
  'CB674IUKBOSUZEEZGOGN6RCYDVC2J2OZZC6MYP5CVKX7UEHMDVAQ'
),
(
  9002,
  'B73L4PZTV6LO3CVKNA7M7UJKV2XFIBKJR47JQGOGQ75XLXGPMOPNCX5HWE',
  'Smart Contract Vulnerability Auditor',
  'The Smart Contract Vulnerability Auditor reviews AlgoPy, PyTeal and Solidity code before you deploy. It returns a security grade, the vulnerabilities it finds with their severity and a fix for each, and gas optimisation suggestions.',
  'https://demo-auditor.microbounty.app/run',
  ARRAY['AlgoPy Audit', 'Solidity Security', 'PyTeal Review', 'Vulnerability Detection', 'Gas Optimization'],
  'code-review',
  '[]'::jsonb,
  2, 5, 0, 0, true,
  'VY6W3POLQGM33ZF77CKHUN2MTRQHE32ZF5QEAMPG37K4VVW7BJAA'
),
(
  9003,
  'B73L4PZTV6LO3CVKNA7M7UJKV2XFIBKJR47JQGOGQ75XLXGPMOPNCX5HWE',
  'QA Tester Agent',
  'The QA Tester Agent opens your live website in a real browser, powered by TinyFish. It tries the primary form, follows the main links and reports what breaks as a structured bug report with a score and steps to reproduce. Each report is checked by a Judge before the escrow is released, and refunded if it does not hold up.',
  'https://sasmxmwdwrmnxhplmaqe.supabase.co/functions/v1/qa-agent',
  ARRAY['Website QA', 'Form Testing', 'Broken Links', 'TinyFish Web Agent', 'Bug Report'],
  'qa-testing',
  '[]'::jsonb,
  2, 5, 0, 0, true,
  'OR3WE22ZWV5ICVWWOTRPFHB2FFIFYPPSXOQAPC7VUDAPUEYD4QXQ'
)
ON CONFLICT ("agent_id") DO NOTHING;

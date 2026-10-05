/**
 * Fixture Reporter brief in the M2 format (prompts file §1 OUTPUT + the
 * approved NUMBERS format). Hand-built from TechCrunch, "Trump unveils his
 * new Super Intelligence Force" (Anthony Ha, 2026-10-04); every quote and
 * number is copied exactly from that article's text. Single source, so
 * every quote carries ⚠.
 */

export const TC_URL = 'https://techcrunch.com/2026/10/04/trump-unveils-his-new-super-intelligence-force/';

export const Q1_TEXT =
  'The Super Intelligence Force is tasked with coordinating the effort of the Federal Government to ensure that America continues to lead the World in Super Intelligence, which many say is bigger than the Industrial Revolution, and the Internet, and will protect the interests, and improve the lives, of all Americans,';

export const BRIEF_SUPER_INTELLIGENCE_FORCE = `SINGLE STORY: yes
THE NEWS: President Donald Trump announced a new Super Intelligence Force on Sunday, Oct. 4, 2026, to be led by national intelligence director Jay Clayton [F1, F2].
WHY IT MATTERS (sourced only):
- The task force's charter reportedly says it will plan responses to SI-enabled threats while preventing overregulation [F6].
- It will reportedly have 120 days to report on the risks and opportunities presented by AI [F4].
FACTS:
F1: Trump announced the formation of a new Super Intelligence Force in a Sunday morning post on Truth Social. (TechCrunch)
F2: Trump said the force will be led by national intelligence director Jay Clayton and other members of his administration. (TechCrunch)
F3: The Wall Street Journal reports that Clayton will chair the force, with FTC Chair Andrew Ferguson, Undersecretary of War for Research and Engineering Emil Michael and OPM Director Scott Kupor as vice chairs. (TechCrunch, The Wall Street Journal)
F4: The task force will reportedly have 120 days to create a report on the risks and opportunities presented by AI. (TechCrunch, The Wall Street Journal)
F5: [CLAIM: Trump says] The force is tasked with coordinating the federal effort to ensure America leads in super intelligence. (TechCrunch)
F6: The task force's charter reportedly says it will develop plans for responding to SI-enabled threats while preventing overregulation. (TechCrunch, The Wall Street Journal)
BACKGROUND:
B1: In September, Trump said he would form an AI Force and appoint an AI czar. (TechCrunch)
B2: Trump signed an executive order seeking to rebrand AI as "super intelligence." (TechCrunch)
QUOTES:
Q1: "${Q1_TEXT}" — Donald Trump, Truth Social post (via TechCrunch) ⚠
Q2: "develop plans for responding to SI-enabled threats to our society, while preventing overregulation and regulatory capture that would stifle innovation and competition." — Super Intelligence Force charter, as reported by The Wall Street Journal (via TechCrunch) ⚠
Q3: "not being first." — Jay Clayton, to The Wall Street Journal (via TechCrunch) ⚠ [cut off]
NUMBERS:
N1: 120 days | duration | time the task force has to report on the risks and opportunities presented by AI | TechCrunch
TERMS:
- Super Intelligence Force: a new task force Trump announced to coordinate the federal government's effort on super intelligence (TechCrunch)
- super intelligence: the term Trump's executive order uses to rebrand AI (TechCrunch)
SUBJECTS:
- Donald Trump | President of the United States
- Jay Clayton | national intelligence director; chair of the Super Intelligence Force
- Andrew Ferguson | Federal Trade Commission Chair; vice chair
- Emil Michael | Undersecretary of War for Research and Engineering; vice chair
- Scott Kupor | Office of Personnel Management Director; vice chair
EVENTS:
- none
ARTICLE PHOTOS:
- (no caption) | Image Credits:Kevin Dietsch / Staff / Getty Images | https://techcrunch.com/wp-content/uploads/2026/09/GettyImages-2297764008.jpg
NOT ANSWERED BY SOURCES:
- The task force's budget and staff.
- When the 120 days start.
SOURCES:
- TechCrunch, October 4, 2026, ${TC_URL}
FETCH FAILURES:
- none
`;

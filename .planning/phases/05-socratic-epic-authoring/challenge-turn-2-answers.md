# Challenge turn 2 — developer answers

**Run:** 01M3QQQM4GAYB2Y9RQMJDRWAX0

## Your answers

ANSWER 1: Current assignee. No separate owner field, and the creator does not count — once a card is handed over, the person who typed it in is irrelevant.
ANSWER 2: No. One assignee, or none. A single assignee is what makes "blocked on you" unambiguous.
ANSWER 3: Greenfield — the repo is empty, so assume you are building the whole thing here: schema, API and UI. Write the tasks against generic integration points (a card-assignment event, a mention parse, a comment write) rather than naming a stack.
ANSWER 4: Settled by answers 1 and 2: trigger 3 is "a comment on a card whose current assignee is you". Drop the word "own" from the spec entirely. That is the whole of it — go ahead and decompose.

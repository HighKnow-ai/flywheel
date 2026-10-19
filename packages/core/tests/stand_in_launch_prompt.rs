//! The prompt a Story session starts with while the MVP's Context packet does not exist yet (issue
//! #38 deleted the old packet builder). It names the Story, carries its acceptance criteria in rank
//! order, and appends the operator's instruction.

mod common;

use core::domain::acceptance_criterion::create_criterion;
use core::domain::session::stand_in_launch_prompt;

use common::{new_story, seeded_project};

#[test]
fn the_prompt_names_the_story_and_lists_its_criteria_in_rank_order() {
    let (mut conn, actor_id, proj) = seeded_project();
    let story = new_story(&mut conn, &proj.id, &actor_id, "Wire the launch");
    create_criterion(&mut conn, &actor_id, &story.id, "First criterion").unwrap();
    create_criterion(&mut conn, &actor_id, &story.id, "Second criterion").unwrap();

    let prompt = stand_in_launch_prompt(&conn, &story.id, "").unwrap();

    assert!(prompt.starts_with(&format!("# {}: Wire the launch\n", story.key)), "{prompt}");
    let first = prompt.find("- First criterion").expect("the first criterion is listed");
    let second = prompt.find("- Second criterion").expect("the second criterion is listed");
    assert!(first < second, "criteria keep their rank order: {prompt}");
    assert!(!prompt.contains("## Instruction"), "an empty instruction adds no heading: {prompt}");
}

#[test]
fn the_instruction_is_appended_and_a_story_with_no_criteria_has_no_criteria_heading() {
    let (mut conn, actor_id, proj) = seeded_project();
    let story = new_story(&mut conn, &proj.id, &actor_id, "Bare story");

    let prompt = stand_in_launch_prompt(&conn, &story.id, "  Run the tests first.  ").unwrap();

    assert!(!prompt.contains("## Acceptance Criteria"), "{prompt}");
    assert!(prompt.ends_with("## Instruction\n\nRun the tests first.\n"), "{prompt}");
}

#[test]
fn an_unknown_story_is_an_error() {
    let (conn, _, _) = seeded_project();
    assert!(stand_in_launch_prompt(&conn, "no-such-story", "").is_err());
}

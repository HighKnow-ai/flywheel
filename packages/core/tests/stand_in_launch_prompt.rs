//! The prompt a task run starts with while the MVP's Context packet does not exist yet (issue #38
//! deleted the old packet builder). It names the task, carries its current acceptance criteria in
//! rank order (the criteria the run's revision pin records), and appends the operator's instruction.

mod common;

use core::domain::acceptance_criterion::create_criterion;
use core::domain::agent_run::stand_in_launch_prompt;
use core::domain::task::create_task;

use common::seeded_project;

#[test]
fn the_prompt_names_the_task_and_lists_its_criteria_in_rank_order() {
    let (mut conn, actor_id, proj) = seeded_project();
    let task = create_task(&mut conn, &proj.id, &actor_id, "Wire the launch", None).unwrap();
    create_criterion(&mut conn, &proj.id, &actor_id, "task", &task.id, "First criterion", None).unwrap();
    create_criterion(&mut conn, &proj.id, &actor_id, "task", &task.id, "Second criterion", None).unwrap();

    let prompt = stand_in_launch_prompt(&conn, &task.id, "").unwrap();

    assert!(prompt.starts_with(&format!("# {}: Wire the launch\n", task.key)), "{prompt}");
    let first = prompt.find("- First criterion").expect("the first criterion is listed");
    let second = prompt.find("- Second criterion").expect("the second criterion is listed");
    assert!(first < second, "criteria keep their rank order: {prompt}");
    assert!(!prompt.contains("## Instruction"), "an empty instruction adds no heading: {prompt}");
}

#[test]
fn the_instruction_is_appended_and_a_task_with_no_criteria_has_no_criteria_heading() {
    let (mut conn, actor_id, proj) = seeded_project();
    let task = create_task(&mut conn, &proj.id, &actor_id, "Bare task", None).unwrap();

    let prompt = stand_in_launch_prompt(&conn, &task.id, "  Run the tests first.  ").unwrap();

    assert!(!prompt.contains("## Acceptance Criteria"), "{prompt}");
    assert!(prompt.ends_with("## Instruction\n\nRun the tests first.\n"), "{prompt}");
}

#[test]
fn an_unknown_task_is_an_error() {
    let (conn, _, _) = seeded_project();
    assert!(stand_in_launch_prompt(&conn, "no-such-task", "").is_err());
}

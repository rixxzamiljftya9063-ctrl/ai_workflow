from threading import Lock


_lock = Lock()
_stopped_workflows: set[int] = set()
_stopped_runs: set[int] = set()


def request_workflow_stop(workflow_id: int) -> None:
    with _lock:
        _stopped_workflows.add(int(workflow_id))


def request_run_stop(run_id: int) -> None:
    with _lock:
        _stopped_runs.add(int(run_id))


def clear_workflow_stop(workflow_id: int) -> None:
    with _lock:
        _stopped_workflows.discard(int(workflow_id))


def clear_run_stop(run_id: int) -> None:
    with _lock:
        _stopped_runs.discard(int(run_id))


def is_stop_requested(workflow_id: int, run_id: int | None = None) -> bool:
    with _lock:
        return int(workflow_id) in _stopped_workflows or (run_id is not None and int(run_id) in _stopped_runs)

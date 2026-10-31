#!/usr/bin/env python3
"""Tiny dependency-free task queue helper for StudioKit agents."""
from __future__ import annotations
import argparse
import json
from datetime import datetime, timezone
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
QUEUE = ROOT / 'tasks' / 'queue.json'


def now():
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def load():
    return json.loads(QUEUE.read_text(encoding='utf-8'))


def save(data):
    tmp = QUEUE.with_suffix('.json.tmp')
    tmp.write_text(json.dumps(data, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    tmp.replace(QUEUE)


def index(data):
    return {task['id']: task for task in data['tasks']}


def ready(task, tasks, owner_authorized=False):
    if task['status'] != 'READY':
        return False
    if task.get('ownerAuthorizationRequired') and not owner_authorized:
        return False
    return all(tasks.get(dep, {}).get('status') == 'DONE' for dep in task.get('dependsOn', []))


def cmd_list(_args):
    data = load(); tasks = index(data)
    for task in data['tasks']:
        deps = ','.join(task.get('dependsOn', [])) or '-'
        gate = ' [OWNER AUTH REQUIRED]' if task.get('ownerAuthorizationRequired') else ''
        print(f"{task['id']:4} {task['status']:12} {task['kind']:7} deps={deps:12} {task['title']}{gate}")


def cmd_next(args):
    data = load(); tasks = index(data)
    for task in data['tasks']:
        if ready(task, tasks, args.owner_authorized):
            print(f"NEXT: {task['id']} — {task['title']} [{task['kind']}]")
            for item in task.get('acceptance', []):
                print(f"  - {item}")
            if task.get('ownerAuthorizationRequired'):
                print('  Owner authorization gate satisfied by explicit --owner-authorized flag; still verify current task authorization.')
            return 0
    print('No eligible READY task. Check dependencies or owner authorization gates.')
    return 1


def cmd_claim(args):
    data = load(); tasks = index(data); task = tasks.get(args.task_id)
    if not task:
        print(f'Unknown task: {args.task_id}', file=sys.stderr); return 2
    if not ready(task, tasks, args.owner_authorized):
        print('Task is not eligible. Check status, dependencies, and owner authorization.', file=sys.stderr); return 2
    task['status'] = 'IN_PROGRESS'
    task['claimedAt'] = now()
    if task.get('ownerAuthorizationRequired'):
        task['ownerAuthorizationVerifiedByAgentFlag'] = True
    save(data)
    print(f"Claimed {task['id']}: {task['title']}")
    return 0


def cmd_done(args):
    data = load(); tasks = index(data); task = tasks.get(args.task_id)
    if not task:
        print(f'Unknown task: {args.task_id}', file=sys.stderr); return 2
    if task['status'] != 'IN_PROGRESS':
        print('Only IN_PROGRESS tasks can be marked DONE.', file=sys.stderr); return 2
    task['status'] = 'DONE'; task['completedAt'] = now(); task['evidence'] = args.evidence
    save(data); print(f"Completed {task['id']}: {task['title']}")
    return 0


def cmd_block(args):
    data = load(); tasks = index(data); task = tasks.get(args.task_id)
    if not task:
        print(f'Unknown task: {args.task_id}', file=sys.stderr); return 2
    task['status'] = 'BLOCKED'; task['blockedAt'] = now(); task['blockReason'] = args.reason
    save(data); print(f"Blocked {task['id']}: {args.reason}")
    return 0


def main():
    parser = argparse.ArgumentParser(description='StudioKit task queue helper')
    sub = parser.add_subparsers(dest='command', required=True)
    p = sub.add_parser('list'); p.set_defaults(func=cmd_list)
    p = sub.add_parser('next'); p.add_argument('--owner-authorized', action='store_true'); p.set_defaults(func=cmd_next)
    p = sub.add_parser('claim'); p.add_argument('task_id'); p.add_argument('--owner-authorized', action='store_true'); p.set_defaults(func=cmd_claim)
    p = sub.add_parser('done'); p.add_argument('task_id'); p.add_argument('--evidence', required=True); p.set_defaults(func=cmd_done)
    p = sub.add_parser('block'); p.add_argument('task_id'); p.add_argument('--reason', required=True); p.set_defaults(func=cmd_block)
    args = parser.parse_args()
    return args.func(args)

if __name__ == '__main__':
    raise SystemExit(main())

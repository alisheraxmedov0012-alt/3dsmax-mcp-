"""Administrative bootstrap CLI.

There is intentionally **no** public admin sign-up endpoint. The first admin is
created through this controlled, documented command, run by an operator with
access to the server environment:

    python -m app.cli create-admin --email admin@example.com

The password is read from the ``ADMIN_PASSWORD`` environment variable or
prompted for interactively; it is never passed as a CLI argument (so it does
not leak into shell history or process listings).
"""
from __future__ import annotations

import argparse
import getpass
import os
import sys

from sqlalchemy import select

from .database import Base, SessionLocal, engine
from .models import User
from .security import hash_password
from .services.plans import seed_plans

MIN_PASSWORD_LENGTH = 8


def create_admin(email: str) -> int:
    Base.metadata.create_all(bind=engine)
    with SessionLocal() as db:
        seed_plans(db)
        normalized = email.strip().lower()
        existing = db.execute(select(User).where(User.email == normalized)).scalar_one_or_none()
        if existing is not None:
            print(f"Xato: '{normalized}' allaqachon mavjud.", file=sys.stderr)
            return 1

        password = os.environ.get("ADMIN_PASSWORD") or getpass.getpass("Admin paroli: ")
        if len(password) < MIN_PASSWORD_LENGTH:
            print(f"Xato: parol kamida {MIN_PASSWORD_LENGTH} belgidan iborat bo'lsin.", file=sys.stderr)
            return 1

        user = User(
            email=normalized,
            password_hash=hash_password(password),
            role="admin",
            is_email_verified=True,
        )
        db.add(user)
        db.commit()
        db.refresh(user)

        print(f"Admin yaratildi: {user.email}")
    return 0


def recover_stale_jobs_command() -> int:
    """Mark jobs left ``running`` by a crashed process as failed (safe, idempotent)."""
    from .services import jobs as jobs_service

    with SessionLocal() as db:
        recovered = jobs_service.recover_stale_jobs(db)
    print(f"Tiklandi: {recovered} ta 'running' vazifa 'failed' holatiga o'tkazildi.")
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="3D Studio AI backend CLI")
    sub = parser.add_subparsers(dest="command", required=True)
    create = sub.add_parser("create-admin", help="Create the first admin user")
    create.add_argument("--email", required=True)
    sub.add_parser(
        "recover-stale-jobs",
        help="Fail jobs stuck in 'running' past their timeout (crash recovery)",
    )
    args = parser.parse_args(argv)

    if args.command == "create-admin":
        return create_admin(args.email)
    if args.command == "recover-stale-jobs":
        return recover_stale_jobs_command()
    return 1


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(main())

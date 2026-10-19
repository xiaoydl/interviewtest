#!/usr/bin/env python3
"""Offline evaluation for the policy assistant.

Standard library only, so it runs without a virtualenv: `python eval/evaluate.py`.

Why a separate component in Python: the metrics and the judgement calls around them change
far more often than the service does, and keeping them out of the TypeScript build means a
change to a scoring rule cannot break the server. It also matches where the wider team keeps
model work.

What it scores, and why each one matters:

  recall@k        did the document that actually answers the question appear in the citations
  citation count  a proxy for over-claiming: citing five documents to answer one fact is a
                  grounding smell, not thoroughness
  refusal rate    how often the assistant said "not in the corpus". Both a false answer and a
                  false refusal are failures, so this is reported, never optimised blindly
  grounding       share of the answer's content words that appear in the cited context, a
                  cheap hallucination smell. It is NOT a faithfulness proof - a paraphrase can
                  score low and still be correct, and an invented sentence using only context
                  words scores high. Read it as a screen, not a verdict.

Usage:
  python eval/evaluate.py --predictions eval/predictions.example.json
  python eval/evaluate.py --predictions preds.json --questions eval/questions.jsonl --verbose
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

WORD = re.compile(r"[a-z0-9']+")
STOP = {
    "the", "a", "an", "and", "or", "of", "to", "in", "for", "on", "is", "are", "be", "with",
    "that", "this", "it", "as", "at", "by", "from", "you", "your", "i", "do", "does", "what",
    "how", "if", "not", "any", "can", "my", "we", "us", "our", "was", "were", "which", "when",
}


def content_words(text: str) -> set[str]:
    return {w for w in WORD.findall(text.lower()) if len(w) > 2 and w not in STOP}


def load_questions(path: Path) -> list[dict]:
    # utf-8-sig: a fixture saved by a Windows editor carries a BOM, and a BOM makes
    # json.loads fail on line 1 with no useful hint about why.
    rows = []
    for line in path.read_text(encoding="utf-8-sig").splitlines():
        line = line.strip()
        if line:
            rows.append(json.loads(line))
    return rows


def load_predictions(path: Path) -> dict:
    data = json.loads(path.read_text(encoding="utf-8-sig"))
    if isinstance(data, list):
        return {row["question"]: row for row in data}
    return data


def is_refusal(answer: str) -> bool:
    lowered = answer.lower()
    return "could not find" in lowered or "not in the" in lowered or "no policy" in lowered


def evaluate(questions: list[dict], predictions: dict, k: int) -> dict:
    per_question = []
    for row in questions:
        question = row["question"]
        expected = row.get("expected_docs", [])
        prediction = predictions.get(question)
        if prediction is None:
            per_question.append({"question": question, "status": "missing", "recall": 0.0})
            continue

        answer = prediction.get("answer", "")
        cited = [c.get("docId") for c in prediction.get("citations", [])]
        context = prediction.get("context", "")

        hit = bool(set(expected) & set(cited[:k])) if expected else None
        answer_words = content_words(answer)
        grounding = (
            len(answer_words & content_words(context)) / len(answer_words) if answer_words else 0.0
        )

        per_question.append(
            {
                "question": question,
                "status": "ok",
                "expected": expected,
                "cited": cited,
                "recall": 1.0 if hit else 0.0,
                "hit": hit,
                "citations": len(cited),
                "refused": is_refusal(answer),
                "grounding": round(grounding, 3),
                "words": len(answer.split()),
            }
        )

    scored = [p for p in per_question if p["status"] == "ok" and p.get("hit") is not None]
    return {
        "per_question": per_question,
        "n": len(per_question),
        "n_scored": len(scored),
        "missing": sum(1 for p in per_question if p["status"] == "missing"),
        "recall_at_k": (sum(p["recall"] for p in scored) / len(scored)) if scored else 0.0,
        "mean_citations": (sum(p["citations"] for p in scored) / len(scored)) if scored else 0.0,
        "refusal_rate": (
            sum(1 for p in per_question if p.get("refused")) / len(per_question)
            if per_question
            else 0.0
        ),
        "mean_grounding": (
            sum(p["grounding"] for p in scored) / len(scored) if scored else 0.0
        ),
        "mean_words": (sum(p["words"] for p in scored) / len(scored) if scored else 0.0),
    }


def main(argv: list[str]) -> int:
    here = Path(__file__).parent
    parser = argparse.ArgumentParser(description="Score policy-assistant answers.")
    parser.add_argument("--predictions", type=Path, required=True)
    parser.add_argument("--questions", type=Path, default=here / "questions.jsonl")
    parser.add_argument("--k", type=int, default=3, help="consider this many citations for recall")
    parser.add_argument("--verbose", action="store_true")
    args = parser.parse_args(argv)

    if not args.questions.exists():
        print(f"questions file not found: {args.questions}", file=sys.stderr)
        return 2
    if not args.predictions.exists():
        print(f"predictions file not found: {args.predictions}", file=sys.stderr)
        return 2

    questions = load_questions(args.questions)
    predictions = load_predictions(args.predictions)
    report = evaluate(questions, predictions, args.k)

    if report["missing"]:
        print(f"WARNING: {report['missing']} question(s) had no prediction\n")

    print(f"questions {report['n']}  scored {report['n_scored']}")
    print(f"recall@{args.k}        {report['recall_at_k']:.2f}")
    print(f"mean citations  {report['mean_citations']:.1f}")
    print(f"refusal rate    {report['refusal_rate']:.2f}")
    print(f"mean grounding  {report['mean_grounding']:.2f}   (screen, not proof)")
    print(f"mean words      {report['mean_words']:.0f}")

    if args.verbose:
        print("\nper question:")
        for row in report["per_question"]:
            if row["status"] != "ok":
                print(f"  MISSING  {row['question']}")
                continue
            mark = "hit " if row["hit"] else "MISS"
            if row["hit"] is None:
                # No expected document: this is a refusal case. It is excluded from recall, so
                # printing MISS would read as a retrieval failure when it is the opposite.
                mark = "n/a "
            refusal = " refused" if row["refused"] else ""
            print(
                f"  {mark}  recall={row['recall']:.0f} cites={row['citations']}"
                f" ground={row['grounding']:.2f} words={row['words']}{refusal}  {row['question']}"
            )

    # Retrieval below 0.8 on a corpus this small means the ranking, not the model, is the
    # problem. Exiting non-zero makes this usable as a gate in CI later.
    return 0 if report["recall_at_k"] >= 0.8 else 1


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))

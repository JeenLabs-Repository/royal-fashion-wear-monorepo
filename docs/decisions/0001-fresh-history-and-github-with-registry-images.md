# 0001 Fresh History and GitHub With Registry Images

Status: accepted

Date: 2026-11-24

## Context

The project starts from a public starter and will diverge from it. The starter ships an update workflow that opens pull requests with repository write access, which is a supply-chain risk.

## Decision

Start from a snapshot of the starter's files with one signed initial commit. Keep the MIT license. Add no upstream remote. Host the code on GitHub, run CI on GitHub Actions with GitHub-hosted runners and push images to GHCR. The server only pulls images. Remove the starter's update and deploy-notify workflows.

## Consequences

History from the starter cannot be merged back without rewriting it. CI and image storage depend on GitHub.

Undo cost: costly, because moving the host later means rebuilding workflows, protections and the image pipeline.

## Alternatives Considered

- Fork the starter and keep its history. Rejected because the project diverges and the update workflow adds risk.
- Build images on the server. Rejected because the server must not spend memory on builds.

---
version: reel-ai-drama-v1
name: Helios — Reel AI Drama frame (full-screen documentary)
description: >
  A 60–75s vertical mini-documentary about how the AI world was built, driven by real photos, pages,
  documents and maps shown full screen with a documentary grade, grain and Ken Burns moves. Helios
  carries the words, type and accent colour; the pictures keep the documentary grade (MD-44). The board,
  whiteboard and newspaper are tools for a moment, not the stage (MD-03). Decisions: planning/AI Mini
  Docs/PLAN.md (MD-03, MD-13, MD-14, MD-18, MD-34, MD-35, MD-41 to MD-46).
unit: the frame — 1080×1920 (9:16); frames are DOM built with the kit (assets/kit/components/)
principle: one image, one job · real media full screen · Helios words on documentary pictures · every sound is an action's own or the place's ambience

colors:
  ink: "#1F1915"
  canvas: "#FEF9F3"
  accent: "#FF5E1A"
  night: "#0D0B0A"
  paper: "#F4EFE7"
  caption-light: "#FEF9F3"

typography:
  # display and body are the caption's faces (captions.mjs); both ship as files in assets/fonts
  display:   { fontFamily: "Pragmatica Extended", px: 74, weight: 700, lineHeight: 1.05, tracking: "-0.02em", lower: true, color: "ink" }
  body:      { fontFamily: "Roboto", px: 36, weight: 500, lineHeight: 1.2, color: "ink" }
spacing:
  safe-x0: "96px"
  safe-x1: "940px"
  caption-band-top: "260px"
  caption-band-bottom: "560px"
  words-y0: "600px"
  words-y1: "1500px"
  min-readable-text: "26px on screen"
---

# Reel AI Drama — frame system

The kit guide is **`assets/kit/FRAME.md`**: every treatment and its options, motion and sound, the frame
module contract, what is forbidden, and determinism. Read it before building a frame. This file only
carries the tokens the caption skin reads.

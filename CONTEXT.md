# Worksheet Preparation

WriteSpacer helps a teacher select up to eight prompts from source material and turn them into a one-sided printable handout while keeping the source prompts intact.

## Language

**Source page**:
The single photographed or scanned worksheet image a teacher chooses as input.
_Avoid_: Upload, original worksheet

**Detection draft**:
The untouched set of review items suggested from a source page. It is a recoverable starting point, never the source of truth.
_Avoid_: Detection result, final boxes

**Problem candidate**:
A prompt found in the source that is available for the teacher’s handout selection.
_Avoid_: Detection, box, parsed problem

**Problem selection**:
The ordered set of no more than eight problem candidates chosen for one handout.
_Avoid_: Included boxes, output list

**Handout slot**:
One of at most eight predetermined positions for a selected problem and its student workspace on the output side.
_Avoid_: Layout cell, answer box

**One-page handout**:
The single printable page side produced from a problem selection. It never spills onto another side.
_Avoid_: PDF layout, worksheet pages

**Review draft**:
The teacher's current, editable interpretation of the source page, including item order and inclusion.
_Avoid_: Detection result, worksheet

**Review item**:
An ordered source-page region classified as either a problem or a section header. A review item can be excluded without being destroyed.
_Avoid_: Box, region

**Review question**:
A plain-language ambiguity about one review item that requires teacher judgment before the draft is considered ready. It describes the decision, not a confidence score or analysis method.
_Avoid_: Warning, low-confidence item, detector error

**Problem**:
A review item that becomes one prompt with student workspace in the handout.
_Avoid_: Question box, crop

**Section header**:
A review item that introduces the following problem group and appears once in the handout without receiving answer space.
_Avoid_: Instruction problem, heading box

**Prompt fragment**:
A source-page region belonging to a review item, such as its label, equation text, or diagram.
_Avoid_: Crop piece, component

**Diagram attachment**:
The relationship assigning a diagram prompt fragment to one problem.
_Avoid_: Diagram box, nearby image

**Reading order**:
The explicit sequence in which included review items appear in the handout.
_Avoid_: Detection order, visual order

**Correction**:
One teacher action that changes the review draft and can be undone as a unit.
_Avoid_: Edit, intervention

**Handout preview**:
The one-page handout shown before download. Its prompt crops and placements match the downloaded PDF.
_Avoid_: PDF mockup, estimate

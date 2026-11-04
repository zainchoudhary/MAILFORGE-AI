# Recipient Group Preview and Searchable Dropdowns Design

## Intent

Let users inspect a saved recipient group without editing it, use correct singular delete copy, and find options quickly wherever the app presents selectable recipient, group, campaign, template, or configuration data.

## Decisions

- Recipient group cards receive a read-only Preview action. Its dialog shows the group name, member count, and each saved member's name, email, company, and position. It cannot edit membership.
- The single-recipient deletion modal says `This recipient is not in any saved recipient group.` The bulk version keeps plural copy.
- A reusable `SearchablePickerDropdown` extends the existing custom dropdown design with an optional search field. It preserves outside-click close, Escape close, selection indicators, and keyboard-safe buttons.
- Custom dropdowns backed by variable option lists use search. Fixed short status/security/date controls stay compact and do not gain unnecessary search inputs.

## Scope

- Recipient groups preview.
- Recipient, recipient-group, campaign, sender, template, attachment, and similar variable-option dropdowns.
- Existing native selects that are data-driven or have meaningful option lists.

## Non-goals

- Changing backend ownership rules, group editing, campaign delivery, or fixed two-to-five-option controls.

## Approaches considered

1. Add bespoke search controls to each page. Rejected because interaction and accessibility drift would return.
2. Replace every select, including short static settings, with a search picker. Rejected because it adds friction where search has no value.
3. Extend the existing reusable picker and migrate data-driven dropdowns. Selected because it preserves the design system while making selection scalable.

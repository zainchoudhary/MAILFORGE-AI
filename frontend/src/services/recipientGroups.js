export function groupPreviewMembers(group, recipients) {
  const memberIds = new Set(group?.recipient_ids || []);
  return (recipients || [])
    .filter((recipient) => memberIds.has(recipient.id))
    .sort((left, right) => (left.name || left.email).localeCompare(right.name || right.email));
}

export function getGroupPreviewMembers(group) {
  return groupPreviewMembers(group, group?.recipient_members || []);
}

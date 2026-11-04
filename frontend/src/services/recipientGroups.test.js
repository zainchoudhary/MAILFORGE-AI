import { describe, expect, it } from 'vitest';
import { getGroupPreviewMembers, groupPreviewMembers } from './recipientGroups';

describe('groupPreviewMembers', () => {
  it('returns only the group members available in the current recipient list', () => {
    const members = groupPreviewMembers(
      { recipient_ids: ['recipient-2', 'missing', 'recipient-1'] },
      [
        { id: 'recipient-1', name: 'Ayesha Khan', email: 'ayesha@example.com' },
        { id: 'recipient-2', name: 'Omar Siddiqui', email: 'omar@example.com' },
      ],
    );
    expect(members.map((member) => member.email)).toEqual(['ayesha@example.com', 'omar@example.com']);
  });
});

describe('getGroupPreviewMembers', () => {
  it('uses the member summaries already included with a saved group', () => {
    const members = getGroupPreviewMembers({
      recipient_ids: ['recipient-2', 'recipient-1'],
      recipient_members: [
        { id: 'recipient-2', name: 'Omar Siddiqui', email: 'omar@example.com' },
        { id: 'recipient-1', name: 'Ayesha Khan', email: 'ayesha@example.com' },
      ],
    });

    expect(members.map((member) => member.email)).toEqual(['ayesha@example.com', 'omar@example.com']);
  });
});

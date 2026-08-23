export type UserId = string;
export type BoardId = string;
export type ListId = string;
export type CardId = string;
export type LabelId = string;
export type FieldId = string;

export type User = {
  id: UserId;
  firstName: string;
  lastName: string;
  name: string;
  role: string;
  hue: number;
};

export type Label = {
  id: LabelId;
  name: string;
  color: string;
};

export type FieldType = 'text' | 'number' | 'currency' | 'date' | 'boolean';

export type FieldDef = {
  id: FieldId;
  name: string;
  type: FieldType;
};

export type ChecklistItem = {
  id: string;
  text: string;
  done: boolean;
  due?: string | null;
};

export type Checklist = {
  id: string;
  title: string;
  items: ChecklistItem[];
};

export type Attachment = {
  id: string;
  name: string;
  mime: string;
  size?: string;
  addedAt: string;
  url?: string;
};

export type Comment = {
  id: string;
  authorId: UserId;
  body: string;
  at: string;
};

export type ActivityEntry = {
  id: string;
  authorId: UserId;
  kind: 'moved' | 'created' | 'checked' | 'commented' | 'assigned' | 'labeled';
  detail: string;
  at: string;
};

export type Card = {
  id: CardId;
  boardId: BoardId;
  listId: ListId;
  title: string;
  description?: string;
  labelIds: LabelId[];
  assigneeIds: UserId[];
  trackerIds: UserId[];
  due?: string | null;
  complete?: boolean;
  fieldValues: Record<FieldId, string | number | boolean | null>;
  checklists: Checklist[];
  attachments: Attachment[];
  comments: Comment[];
  activity: ActivityEntry[];
  createdById: UserId;
  createdAt: string;
};

export type List = {
  id: ListId;
  boardId: BoardId;
  name: string;
};

export type Board = {
  id: BoardId;
  name: string;
  accent: string;
  fields: FieldDef[];
  labels: Label[];
  workspaceId: string;
  visibility: 'private' | 'public';
  archived?: boolean;
  theme?: 'light' | 'dark';
  canvas?: string | null;
};

export type WorkspaceVisibility = 'private' | 'public' | 'empty';

export type Workspace = {
  id: string;
  name: string;
  slug: string;
  ownerId: UserId;
  description: string;
  tagline: string;
  visibility: WorkspaceVisibility;
  accent: string;
  createdAt: string;
};

export type WorkspaceRole = 'owner' | 'admin' | 'member' | 'guest';

export type WorkspaceMember = {
  id: string;
  workspaceId: string;
  userId: UserId;
  role: WorkspaceRole;
  joinedAt: string;
};

export type Availability = 'available' | 'away';

export type UserProfile = {
  userId: UserId;
  tagline: string;
  bio: string;
  timezone: string;
  pronouns?: string;
  availability: Availability;
  hue: number | null;
  notify: {
    mentions: boolean;
    assignments: boolean;
    dueSoon: boolean;
    dailyDigest: boolean;
  };
  joinedAt: string;
};

export const HUE_PRESETS: { name: string; hue: number }[] = [
  { name: 'Sunset', hue: 22 },
  { name: 'Amber', hue: 45 },
  { name: 'Grove', hue: 142 },
  { name: 'Sky', hue: 205 },
  { name: 'Ocean', hue: 220 },
  { name: 'Violet', hue: 268 },
  { name: 'Magenta', hue: 300 },
  { name: 'Rose', hue: 340 },
];

export type NotificationType =
  | 'assignment'
  | 'mention'
  | 'due_soon'
  | 'due_overdue'
  | 'comment'
  | 'moved'
  | 'due_changed'
  | 'track_activity';

export type NotificationEntityType = 'card' | 'board' | 'comment' | 'checklist_item';

export type Notification = {
  id: string;
  userId: UserId;
  type: NotificationType;
  entityType: NotificationEntityType;
  entityUrl: string;
  actorId?: UserId;
  cardId?: string;
  boardId?: string;
  preview?: string;
  read: boolean;
  createdAt: string;
};

export const savedViews = [
  { id: 'sv_mine', name: 'My cards' },
  { id: 'sv_week', name: 'Due this week' },
  { id: 'sv_activity', name: 'Activity' },
  { id: 'sv_archive', name: 'Archived' },
] as const;

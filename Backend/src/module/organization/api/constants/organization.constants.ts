/** 409 — the singleton slot is taken (pre-check and the 23505 race path). */
export const ORGANIZATION_EXISTS_STATUS = 'organization_exists';
export const ORGANIZATION_EXISTS_MESSAGE =
  'An organization already exists. Delete it before creating a new one.';

/** 404 — PATCH/DELETE when no organization row exists. */
export const ORGANIZATION_NOT_FOUND_STATUS = 'organization_not_found';
export const ORGANIZATION_NOT_FOUND_MESSAGE = 'Organization not found.';

/** 403 — a PM who does not own the organization tried to manage it. */
export const NOT_ORGANIZATION_OWNER_STATUS = 'not_organization_owner';
export const NOT_ORGANIZATION_OWNER_MESSAGE =
  'Only the organization owner can perform this action.';

/** 403 — role below PM (Dev), or Admin attempting create. */
export const PM_REQUIRED_STATUS = 'pm_required';
export const PM_REQUIRED_MESSAGE = 'Only a PM can perform this action.';

/** 400 — PATCH body stripped down to zero known fields. */
export const EMPTY_UPDATE_STATUS = 'empty_update';
export const EMPTY_UPDATE_MESSAGE = 'Provide at least one field to update.';

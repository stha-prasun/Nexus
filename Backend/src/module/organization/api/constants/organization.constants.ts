/** 409 — the singleton slot is taken (pre-check and the 23505 race path). */
export const ORGANIZATION_EXISTS_STATUS = 'organization_exists';
export const ORGANIZATION_EXISTS_MESSAGE =
  'An organization already exists. Delete it before creating a new one.';

/** 404 — PATCH/DELETE when no organization row exists. */
export const ORGANIZATION_NOT_FOUND_STATUS = 'organization_not_found';
export const ORGANIZATION_NOT_FOUND_MESSAGE = 'Organization not found.';

/** 403 — a non-Admin tried to manage the organization (defense in depth). */
export const NOT_ORGANIZATION_OWNER_STATUS = 'not_organization_owner';
export const NOT_ORGANIZATION_OWNER_MESSAGE =
  'Only an Admin can manage the organization.';

/** 403 — role other than Admin attempted create (defense in depth). */
export const ADMIN_REQUIRED_STATUS = 'admin_required';
export const ADMIN_REQUIRED_MESSAGE = 'Only an Admin can perform this action.';

/** 400 — PATCH body stripped down to zero known fields. */
export const EMPTY_UPDATE_STATUS = 'empty_update';
export const EMPTY_UPDATE_MESSAGE = 'Provide at least one field to update.';

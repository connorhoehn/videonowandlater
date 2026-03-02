import { PreSignUpTriggerHandler } from 'aws-lambda';

/**
 * Auto-confirms users on signup since we don't require email verification.
 * This allows self-signup users to log in immediately without confirmation.
 */
export const handler: PreSignUpTriggerHandler = async (event) => {
  // Auto-confirm the user
  event.response.autoConfirmUser = true;

  // Auto-verify email if provided (though we don't require it)
  if (event.request.userAttributes.email) {
    event.response.autoVerifyEmail = true;
  }

  return event;
};

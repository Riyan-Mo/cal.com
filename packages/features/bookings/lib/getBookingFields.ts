import type { EventTypeCustomInput, EventType, Prisma, Workflow } from "@prisma/client";
import { z } from "zod";

import type { FieldTypeConfig } from "@calcom/features/form-builder/FormBuilderFieldsSchema";
import slugify from "@calcom/lib/slugify";
import {
  BookingFieldType,
  customInputSchema,
  eventTypeBookingFields,
  EventTypeMetaDataSchema,
} from "@calcom/prisma/zod-utils";

type Fields = z.infer<typeof eventTypeBookingFields>;

export const SMS_REMINDER_NUMBER_FIELD = "smsReminderNumber";

const FieldTypeConfigMap: Partial<Record<Fields[0]["type"], z.infer<typeof FieldTypeConfig>>> = {
  // This won't be stored in DB. It allows UI to be configured from the codebase for all existing booking fields stored in DB as well
  // Candidates for this are:
  // - Anything that you want to show in App UI only.
  // - Default values that are shown in UI that are supposed to be changed for existing bookingFields as well if user is using default values
  name: {
    variantsConfig: {
      toggleLabel: 'Split "Full name" into "First name" and "Last name"',
      variants: {
        firstAndLastName: {
          label: "First Name, Last Name",
          fieldsMap: {
            firstName: {
              defaultLabel: "first_name",
              canChangeRequirability: false,
            },
            lastName: {
              defaultLabel: "last_name",
              canChangeRequirability: true,
            },
          },
        },
        fullName: {
          label: "your_name",
          fieldsMap: {
            fullName: {
              defaultLabel: "your_name",
              defaultPlaceholder: "example_name",
              canChangeRequirability: false,
            },
          },
        },
      },
    },
  },
};
/**
 * PHONE -> Phone
 */
function upperCaseToCamelCase(upperCaseString: string) {
  return upperCaseString[0].toUpperCase() + upperCaseString.slice(1).toLowerCase();
}

export const getSmsReminderNumberField = () =>
  ({
    name: SMS_REMINDER_NUMBER_FIELD,
    type: "phone",
    defaultLabel: "number_sms_notifications",
    defaultPlaceholder: "enter_phone_number",
    editable: "system",
  } as const);

export const getSmsReminderNumberSource = ({
  workflowId,
  isSmsReminderNumberRequired,
}: {
  workflowId: Workflow["id"];
  isSmsReminderNumberRequired: boolean;
}) => ({
  id: "" + workflowId,
  type: "workflow",
  label: "Workflow",
  fieldRequired: isSmsReminderNumberRequired,
  editUrl: `/workflows/${workflowId}`,
});

const EventTypeCustomInputType = {
  TEXT: "TEXT",
  TEXTLONG: "TEXTLONG",
  NUMBER: "NUMBER",
  BOOL: "BOOL",
  RADIO: "RADIO",
  PHONE: "PHONE",
} as const;

export const SystemField = z.enum([
  "name",
  "email",
  "location",
  "notes",
  "guests",
  "rescheduleReason",
  "smsReminderNumber",
]);

/**
 * This fn is the key to ensure on the fly mapping of customInputs to bookingFields and ensuring that all the systems fields are present and correctly ordered in bookingFields
 */
export const getBookingFieldsWithSystemFields = ({
  bookingFields,
  disableGuests,
  customInputs,
  metadata,
  workflows,
}: {
  bookingFields: Fields | EventType["bookingFields"];
  disableGuests: boolean;
  customInputs: EventTypeCustomInput[] | z.infer<typeof customInputSchema>[];
  metadata: EventType["metadata"] | z.infer<typeof EventTypeMetaDataSchema>;
  workflows: Prisma.EventTypeGetPayload<{
    select: {
      workflows: {
        select: {
          workflow: {
            select: {
              id: true;
              steps: true;
            };
          };
        };
      };
    };
  }>["workflows"];
}) => {
  const parsedMetaData = EventTypeMetaDataSchema.parse(metadata || {});
  const parsedBookingFields = eventTypeBookingFields.parse(bookingFields || []);
  const parsedCustomInputs = customInputSchema.array().parse(customInputs || []);
  workflows = workflows || [];
  return ensureBookingInputsHaveSystemFields({
    bookingFields: parsedBookingFields,
    disableGuests,
    additionalNotesRequired: parsedMetaData?.additionalNotesRequired || false,
    customInputs: parsedCustomInputs,
    workflows,
  });
};

export const ensureBookingInputsHaveSystemFields = ({
  bookingFields,
  disableGuests,
  additionalNotesRequired,
  customInputs,
  workflows,
}: {
  bookingFields: Fields;
  disableGuests: boolean;
  additionalNotesRequired: boolean;
  customInputs: z.infer<typeof customInputSchema>[];
  workflows: Prisma.EventTypeGetPayload<{
    select: {
      workflows: {
        select: {
          workflow: {
            select: {
              id: true;
              steps: true;
            };
          };
        };
      };
    };
  }>["workflows"];
}) => {
  // If bookingFields is set already, the migration is done.
  const handleMigration = !bookingFields.length;
  const CustomInputTypeToFieldType = {
    [EventTypeCustomInputType.TEXT]: BookingFieldType.text,
    [EventTypeCustomInputType.TEXTLONG]: BookingFieldType.textarea,
    [EventTypeCustomInputType.NUMBER]: BookingFieldType.number,
    [EventTypeCustomInputType.BOOL]: BookingFieldType.boolean,
    [EventTypeCustomInputType.RADIO]: BookingFieldType.radio,
    [EventTypeCustomInputType.PHONE]: BookingFieldType.phone,
  };

  const smsNumberSources = [] as NonNullable<(typeof bookingFields)[number]["sources"]>;
  workflows.forEach((workflow) => {
    workflow.workflow.steps.forEach((step) => {
      if (step.action === "SMS_ATTENDEE") {
        const workflowId = workflow.workflow.id;
        smsNumberSources.push(
          getSmsReminderNumberSource({
            workflowId,
            isSmsReminderNumberRequired: !!step.numberRequired,
          })
        );
      }
    });
  });

  // These fields should be added before other user fields
  const systemBeforeFields: typeof bookingFields = [
    {
      // This is the name of the main field
      type: "name",
      name: "name",
      editable: "system",
      // Label is currently required by Email Sending logic
      // Need to write a toText() fn to convert a field to text that can output multiple label and value pairs
      defaultLabel: "your_name",
      required: true,
      variantsConfig: {
        defaultVariant: "fullName",
        variants: {
          firstAndLastName: {
            fields: [
              {
                // This name won't be configurable by user. User can always configure the main field name
                name: "firstName",
                type: "text",
                label: "First Name",
                required: true,
              },
              {
                name: "lastName",
                type: "text",
                label: "Last Name",
                required: false,
              },
            ],
          },
          fullName: {
            fields: [
              {
                name: "fullName",
                type: "text",
                label: "Your Name",
                required: true,
              },
            ],
          },
        },
      },
      sources: [
        {
          label: "Default",
          id: "default",
          type: "default",
        },
      ],
    },
    {
      defaultLabel: "email_address",
      type: "email",
      name: "email",
      required: true,
      editable: "system",
      sources: [
        {
          label: "Default",
          id: "default",
          type: "default",
        },
      ],
    },
    {
      defaultLabel: "location",
      type: "radioInput",
      name: "location",
      editable: "system",
      hideWhenJustOneOption: true,
      required: false,
      getOptionsAt: "locations",
      optionsInputs: {
        attendeeInPerson: {
          type: "address",
          required: true,
          placeholder: "",
        },
        phone: {
          type: "phone",
          required: true,
          placeholder: "",
        },
      },
      sources: [
        {
          label: "Default",
          id: "default",
          type: "default",
        },
      ],
    },
  ];

  // These fields should be added after other user fields
  const systemAfterFields: typeof bookingFields = [
    {
      defaultLabel: "additional_notes",
      type: "textarea",
      name: "notes",
      editable: "system-but-optional",
      required: additionalNotesRequired,
      defaultPlaceholder: "share_additional_notes",
      sources: [
        {
          label: "Default",
          id: "default",
          type: "default",
        },
      ],
    },
    {
      defaultLabel: "additional_guests",
      type: "multiemail",
      editable: "system-but-optional",
      name: "guests",
      required: false,
      hidden: disableGuests,
      sources: [
        {
          label: "Default",
          id: "default",
          type: "default",
        },
      ],
    },
    {
      defaultLabel: "reschedule_reason",
      type: "textarea",
      editable: "system-but-optional",
      name: "rescheduleReason",
      defaultPlaceholder: "reschedule_placeholder",
      required: false,
      views: [
        {
          id: "reschedule",
          label: "Reschedule View",
        },
      ],
      sources: [
        {
          label: "Default",
          id: "default",
          type: "default",
        },
      ],
    },
  ];

  const missingSystemBeforeFields = [];
  for (const field of systemBeforeFields) {
    const existingBookingFieldIndex = bookingFields.findIndex((f) => f.name === field.name);
    // Only do a push, we must not update existing system fields as user could have modified any property in it,
    if (existingBookingFieldIndex === -1) {
      missingSystemBeforeFields.push(field);
    } else {
      // Adding the fields from Code first and then fields from DB. Allows, the code to push new properties to the field
      bookingFields[existingBookingFieldIndex] = {
        ...field,
        ...bookingFields[existingBookingFieldIndex],
      };
    }
  }

  bookingFields = missingSystemBeforeFields.concat(bookingFields);

  // Backward Compatibility for SMS Reminder Number
  // Note: We still need workflows in `getBookingFields` due to Backward Compatibility. If we do a one time entry for all event-types, we can remove workflows from `getBookingFields`
  // Also, note that even if Workflows don't explicity add smsReminderNumber field to bookingFields, it would be added as a side effect of this backward compatibility logic
  if (smsNumberSources.length && !bookingFields.find((f) => f.name !== SMS_REMINDER_NUMBER_FIELD)) {
    const indexForLocation = bookingFields.findIndex((f) => f.name === "location");
    // Add the SMS Reminder Number field after `location` field always
    bookingFields.splice(indexForLocation + 1, 0, {
      ...getSmsReminderNumberField(),
      sources: smsNumberSources,
    });
  }

  // Backward Compatibility: If we are migrating from old system, we need to map `customInputs` to `bookingFields`
  if (handleMigration) {
    customInputs.forEach((input, index) => {
      const label = input.label || `${upperCaseToCamelCase(input.type)}`;
      bookingFields.push({
        label: label,
        editable: "user",
        // Custom Input's slugified label was being used as query param for prefilling. So, make that the name of the field
        // Also Custom Input's label could have been empty string as well. But it's not possible to have empty name. So generate a name automatically.
        name: slugify(input.label || `${input.type}-${index + 1}`),
        placeholder: input.placeholder,
        type: CustomInputTypeToFieldType[input.type],
        required: input.required,
        options: input.options
          ? input.options.map((o) => {
              return {
                ...o,
                // Send the label as the value without any trimming or lowercase as this is what customInput are doing. It maintains backward compatibility
                value: o.label,
              };
            })
          : [],
      });
    });
  }

  const missingSystemAfterFields = [];
  for (const field of systemAfterFields) {
    const existingBookingFieldIndex = bookingFields.findIndex((f) => f.name === field.name);
    // Only do a push, we must not update existing system fields as user could have modified any property in it,
    if (existingBookingFieldIndex === -1) {
      missingSystemAfterFields.push(field);
    } else {
      bookingFields[existingBookingFieldIndex] = {
        // Adding the fields from Code first and then fields from DB. Allows, the code to push new properties to the field
        ...field,
        ...bookingFields[existingBookingFieldIndex],
      };
    }
  }

  bookingFields = bookingFields.concat(missingSystemAfterFields).map((field) => {
    const fieldTypeConfig = FieldTypeConfigMap[field.type];
    if (!fieldTypeConfig) {
      return field;
    }
    return {
      ...field,
      fieldTypeConfig: fieldTypeConfig,
    };
  });

  return eventTypeBookingFields.brand<"HAS_SYSTEM_FIELDS">().parse(bookingFields);
};

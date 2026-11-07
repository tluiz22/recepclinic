import { formOptionalText, formText } from "./forms";
import type { PayerAddressInput } from "./data/billing";

/** Campos do formulário do endereço do pagador (PayerAddressForm.astro). */
export function addressFromForm(form: FormData | null): PayerAddressInput {
  return {
    postalCode: formText(form, "postal_code"),
    street: formText(form, "street"),
    number: formText(form, "address_number"),
    complement: formOptionalText(form, "address_complement"),
    district: formText(form, "district"),
    city: formText(form, "city"),
    state: formText(form, "state"),
  };
}

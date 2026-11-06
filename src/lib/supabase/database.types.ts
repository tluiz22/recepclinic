
export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]

export type Database = {
  
  "public": {
          Tables: {
            "agenda_import_requests": {
                  Row: {
                    "clinic_id": string,"email": string,"entries": NonNullable<Json>,"expires_at": string,"id": string,"link_sent_at": string,"loaded_at": string | null,"loaded_by": string | null,"requested_at": string,"requested_by": string | null,"return_comment": string | null,"returned_at": string | null,"returned_by": string | null,"saved_at": string | null,"status": string,"submitted_at": string | null,"token_hash": string,"undone_at": string | null,"undone_by": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "clinic_id": string,"email": string,"entries"?: NonNullable<Json>,"expires_at": string,"id"?: string,"link_sent_at"?: string,"loaded_at"?: string | null,"loaded_by"?: string | null,"requested_at"?: string,"requested_by"?: string | null,"return_comment"?: string | null,"returned_at"?: string | null,"returned_by"?: string | null,"saved_at"?: string | null,"status"?: string,"submitted_at"?: string | null,"token_hash": string,"undone_at"?: string | null,"undone_by"?: string | null
                  }
                  Update: {
                    "clinic_id"?: string,"email"?: string,"entries"?: NonNullable<Json>,"expires_at"?: string,"id"?: string,"link_sent_at"?: string,"loaded_at"?: string | null,"loaded_by"?: string | null,"requested_at"?: string,"requested_by"?: string | null,"return_comment"?: string | null,"returned_at"?: string | null,"returned_by"?: string | null,"saved_at"?: string | null,"status"?: string,"submitted_at"?: string | null,"token_hash"?: string,"undone_at"?: string | null,"undone_by"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "agenda_import_requests_clinic_id_fkey"
      columns: ["clinic_id"]
isOneToOne: false
      referencedRelation: "clinics"
      referencedColumns: ["id"]
    }
                  ]
                },"agendas": {
                  Row: {
                    "buffer_minutes": number,"clinic_id": string,"created_at": string,"id": string,"is_active": boolean,"kind": Database["public"]['Enums']["agenda_kind"],"name": string,"professional_id": string | null,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "buffer_minutes"?: number,"clinic_id": string,"created_at"?: string,"id"?: string,"is_active"?: boolean,"kind": Database["public"]['Enums']["agenda_kind"],"name": string,"professional_id"?: string | null,"updated_at"?: string
                  }
                  Update: {
                    "buffer_minutes"?: number,"clinic_id"?: string,"created_at"?: string,"id"?: string,"is_active"?: boolean,"kind"?: Database["public"]['Enums']["agenda_kind"],"name"?: string,"professional_id"?: string | null,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "agendas_clinic_id_fkey"
      columns: ["clinic_id"]
isOneToOne: false
      referencedRelation: "clinics"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "agendas_clinic_id_professional_id_fkey"
      columns: ["clinic_id","professional_id"]
isOneToOne: false
      referencedRelation: "professionals"
      referencedColumns: ["clinic_id","id"]
    }
                  ]
                },"appointment_events": {
                  Row: {
                    "actor_id": string | null,"appointment_id": string,"channel": string,"clinic_id": string,"details": NonNullable<Json>,"event_type": string,"id": number,"occurred_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "actor_id"?: string | null,"appointment_id": string,"channel": string,"clinic_id": string,"details"?: NonNullable<Json>,"event_type": string,"id"?: never,"occurred_at"?: string
                  }
                  Update: {
                    "actor_id"?: string | null,"appointment_id"?: string,"channel"?: string,"clinic_id"?: string,"details"?: NonNullable<Json>,"event_type"?: string,"id"?: never,"occurred_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "appointment_events_clinic_id_appointment_id_fkey"
      columns: ["clinic_id","appointment_id"]
isOneToOne: false
      referencedRelation: "appointments"
      referencedColumns: ["clinic_id","id"]
    },{
      foreignKeyName: "appointment_events_clinic_id_fkey"
      columns: ["clinic_id"]
isOneToOne: false
      referencedRelation: "clinics"
      referencedColumns: ["id"]
    }
                  ]
                },"appointment_series": {
                  Row: {
                    "agenda_id": string,"clinic_id": string,"created_at": string,"created_by": string | null,"duration_minutes": number,"ended_at": string | null,"ended_by": string | null,"ends_on": string | null,"home_visit_address": string | null,"id": string,"insurance_plan_id": string | null,"interval_weeks": number,"location_id": string,"max_sessions": number | null,"patient_id": string,"service_id": string,"start_time": string,"starts_on": string,"updated_at": string,"weekday": number
                  }
                  ComputedFields: never
                  Insert: {
                    "agenda_id": string,"clinic_id": string,"created_at"?: string,"created_by"?: string | null,"duration_minutes": number,"ended_at"?: string | null,"ended_by"?: string | null,"ends_on"?: string | null,"home_visit_address"?: string | null,"id"?: string,"insurance_plan_id"?: string | null,"interval_weeks"?: number,"location_id": string,"max_sessions"?: number | null,"patient_id": string,"service_id": string,"start_time": string,"starts_on": string,"updated_at"?: string,"weekday": number
                  }
                  Update: {
                    "agenda_id"?: string,"clinic_id"?: string,"created_at"?: string,"created_by"?: string | null,"duration_minutes"?: number,"ended_at"?: string | null,"ended_by"?: string | null,"ends_on"?: string | null,"home_visit_address"?: string | null,"id"?: string,"insurance_plan_id"?: string | null,"interval_weeks"?: number,"location_id"?: string,"max_sessions"?: number | null,"patient_id"?: string,"service_id"?: string,"start_time"?: string,"starts_on"?: string,"updated_at"?: string,"weekday"?: number
                  }
                  Relationships: [
                    {
      foreignKeyName: "appointment_series_clinic_id_agenda_id_fkey"
      columns: ["clinic_id","agenda_id"]
isOneToOne: false
      referencedRelation: "agendas"
      referencedColumns: ["clinic_id","id"]
    },{
      foreignKeyName: "appointment_series_clinic_id_fkey"
      columns: ["clinic_id"]
isOneToOne: false
      referencedRelation: "clinics"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "appointment_series_clinic_id_insurance_plan_id_fkey"
      columns: ["clinic_id","insurance_plan_id"]
isOneToOne: false
      referencedRelation: "insurance_plans"
      referencedColumns: ["clinic_id","id"]
    },{
      foreignKeyName: "appointment_series_clinic_id_location_id_fkey"
      columns: ["clinic_id","location_id"]
isOneToOne: false
      referencedRelation: "locations"
      referencedColumns: ["clinic_id","id"]
    },{
      foreignKeyName: "appointment_series_clinic_id_patient_id_fkey"
      columns: ["clinic_id","patient_id"]
isOneToOne: false
      referencedRelation: "patients"
      referencedColumns: ["clinic_id","id"]
    },{
      foreignKeyName: "appointment_series_clinic_id_service_id_fkey"
      columns: ["clinic_id","service_id"]
isOneToOne: false
      referencedRelation: "services"
      referencedColumns: ["clinic_id","id"]
    }
                  ]
                },"appointment_series_skips": {
                  Row: {
                    "clinic_id": string,"created_at": string,"id": string,"reason": Database["public"]['Enums']["series_skip_reason"],"series_id": string,"skipped_on": string
                  }
                  ComputedFields: never
                  Insert: {
                    "clinic_id": string,"created_at"?: string,"id"?: string,"reason": Database["public"]['Enums']["series_skip_reason"],"series_id": string,"skipped_on": string
                  }
                  Update: {
                    "clinic_id"?: string,"created_at"?: string,"id"?: string,"reason"?: Database["public"]['Enums']["series_skip_reason"],"series_id"?: string,"skipped_on"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "appointment_series_skips_clinic_id_fkey"
      columns: ["clinic_id"]
isOneToOne: false
      referencedRelation: "clinics"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "appointment_series_skips_clinic_id_series_id_fkey"
      columns: ["clinic_id","series_id"]
isOneToOne: false
      referencedRelation: "appointment_series"
      referencedColumns: ["clinic_id","id"]
    }
                  ]
                },"appointments": {
                  Row: {
                    "agenda_id": string,"agenda_import_id": string | null,"booking_channel": Database["public"]['Enums']["action_channel"],"canceled_at": string | null,"canceled_by": string | null,"canceled_via": Database["public"]['Enums']["action_channel"] | null,"clinic_id": string,"confirmed_at": string | null,"created_at": string,"created_by": string | null,"duration_minutes": number,"home_visit_address": string | null,"id": string,"insurance_plan_id": string | null,"is_exam": boolean,"is_group_session": boolean,"location_id": string,"mass_canceled": boolean,"origin_appointment_id": string | null,"patient_confirmed_at": string | null,"patient_confirmed_by": string | null,"patient_id": string,"price_cents": number | null,"rebooking_dismissed_at": string | null,"reminder_response": string | null,"reminder_response_at": string | null,"reminder_sent_at": string | null,"rescheduled_at": string | null,"rescheduled_by": string | null,"rescheduled_via": Database["public"]['Enums']["action_channel"] | null,"scheduled_at": string,"series_id": string | null,"service_id": string,"status": Database["public"]['Enums']["appointment_status"],"trail_context": Json | null,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "agenda_id": string,"agenda_import_id"?: string | null,"booking_channel": Database["public"]['Enums']["action_channel"],"canceled_at"?: string | null,"canceled_by"?: string | null,"canceled_via"?: Database["public"]['Enums']["action_channel"] | null,"clinic_id": string,"confirmed_at"?: string | null,"created_at"?: string,"created_by"?: string | null,"duration_minutes": number,"home_visit_address"?: string | null,"id"?: string,"insurance_plan_id"?: string | null,"is_exam"?: boolean,"is_group_session"?: boolean,"location_id": string,"mass_canceled"?: boolean,"origin_appointment_id"?: string | null,"patient_confirmed_at"?: string | null,"patient_confirmed_by"?: string | null,"patient_id": string,"price_cents"?: number | null,"rebooking_dismissed_at"?: string | null,"reminder_response"?: string | null,"reminder_response_at"?: string | null,"reminder_sent_at"?: string | null,"rescheduled_at"?: string | null,"rescheduled_by"?: string | null,"rescheduled_via"?: Database["public"]['Enums']["action_channel"] | null,"scheduled_at": string,"series_id"?: string | null,"service_id": string,"status"?: Database["public"]['Enums']["appointment_status"],"trail_context"?: Json | null,"updated_at"?: string
                  }
                  Update: {
                    "agenda_id"?: string,"agenda_import_id"?: string | null,"booking_channel"?: Database["public"]['Enums']["action_channel"],"canceled_at"?: string | null,"canceled_by"?: string | null,"canceled_via"?: Database["public"]['Enums']["action_channel"] | null,"clinic_id"?: string,"confirmed_at"?: string | null,"created_at"?: string,"created_by"?: string | null,"duration_minutes"?: number,"home_visit_address"?: string | null,"id"?: string,"insurance_plan_id"?: string | null,"is_exam"?: boolean,"is_group_session"?: boolean,"location_id"?: string,"mass_canceled"?: boolean,"origin_appointment_id"?: string | null,"patient_confirmed_at"?: string | null,"patient_confirmed_by"?: string | null,"patient_id"?: string,"price_cents"?: number | null,"rebooking_dismissed_at"?: string | null,"reminder_response"?: string | null,"reminder_response_at"?: string | null,"reminder_sent_at"?: string | null,"rescheduled_at"?: string | null,"rescheduled_by"?: string | null,"rescheduled_via"?: Database["public"]['Enums']["action_channel"] | null,"scheduled_at"?: string,"series_id"?: string | null,"service_id"?: string,"status"?: Database["public"]['Enums']["appointment_status"],"trail_context"?: Json | null,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "appointments_agenda_import_id_fkey"
      columns: ["agenda_import_id"]
isOneToOne: false
      referencedRelation: "agenda_import_requests"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "appointments_clinic_id_agenda_id_fkey"
      columns: ["clinic_id","agenda_id"]
isOneToOne: false
      referencedRelation: "agendas"
      referencedColumns: ["clinic_id","id"]
    },{
      foreignKeyName: "appointments_clinic_id_fkey"
      columns: ["clinic_id"]
isOneToOne: false
      referencedRelation: "clinics"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "appointments_clinic_id_insurance_plan_id_fkey"
      columns: ["clinic_id","insurance_plan_id"]
isOneToOne: false
      referencedRelation: "insurance_plans"
      referencedColumns: ["clinic_id","id"]
    },{
      foreignKeyName: "appointments_clinic_id_location_id_fkey"
      columns: ["clinic_id","location_id"]
isOneToOne: false
      referencedRelation: "locations"
      referencedColumns: ["clinic_id","id"]
    },{
      foreignKeyName: "appointments_clinic_id_origin_appointment_id_fkey"
      columns: ["clinic_id","origin_appointment_id"]
isOneToOne: false
      referencedRelation: "appointments"
      referencedColumns: ["clinic_id","id"]
    },{
      foreignKeyName: "appointments_clinic_id_patient_id_fkey"
      columns: ["clinic_id","patient_id"]
isOneToOne: false
      referencedRelation: "patients"
      referencedColumns: ["clinic_id","id"]
    },{
      foreignKeyName: "appointments_clinic_id_series_id_fkey"
      columns: ["clinic_id","series_id"]
isOneToOne: false
      referencedRelation: "appointment_series"
      referencedColumns: ["clinic_id","id"]
    },{
      foreignKeyName: "appointments_clinic_id_service_id_fkey"
      columns: ["clinic_id","service_id"]
isOneToOne: false
      referencedRelation: "services"
      referencedColumns: ["clinic_id","id"]
    }
                  ]
                },"availability_windows": {
                  Row: {
                    "agenda_id": string,"capacity": number | null,"clinic_id": string,"created_at": string,"end_time": string,"id": string,"is_active": boolean,"location_id": string,"service_id": string | null,"start_time": string,"updated_at": string,"weekday": number
                  }
                  ComputedFields: never
                  Insert: {
                    "agenda_id": string,"capacity"?: number | null,"clinic_id": string,"created_at"?: string,"end_time": string,"id"?: string,"is_active"?: boolean,"location_id": string,"service_id"?: string | null,"start_time": string,"updated_at"?: string,"weekday": number
                  }
                  Update: {
                    "agenda_id"?: string,"capacity"?: number | null,"clinic_id"?: string,"created_at"?: string,"end_time"?: string,"id"?: string,"is_active"?: boolean,"location_id"?: string,"service_id"?: string | null,"start_time"?: string,"updated_at"?: string,"weekday"?: number
                  }
                  Relationships: [
                    {
      foreignKeyName: "availability_windows_clinic_id_agenda_id_fkey"
      columns: ["clinic_id","agenda_id"]
isOneToOne: false
      referencedRelation: "agendas"
      referencedColumns: ["clinic_id","id"]
    },{
      foreignKeyName: "availability_windows_clinic_id_fkey"
      columns: ["clinic_id"]
isOneToOne: false
      referencedRelation: "clinics"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "availability_windows_clinic_id_location_id_fkey"
      columns: ["clinic_id","location_id"]
isOneToOne: false
      referencedRelation: "locations"
      referencedColumns: ["clinic_id","id"]
    },{
      foreignKeyName: "availability_windows_clinic_id_service_id_fkey"
      columns: ["clinic_id","service_id"]
isOneToOne: false
      referencedRelation: "services"
      referencedColumns: ["clinic_id","id"]
    }
                  ]
                },"booking_links": {
                  Row: {
                    "agenda_id": string | null,"appointment_id": string | null,"canceled_appointment_id": string | null,"clinic_id": string,"contact_id": string,"contact_phone": string,"created_at": string,"expires_at": string,"funnel_session_id": string | null,"home_visit_address": string | null,"id": string,"insurance_plan_id": string | null,"join_waitlist": boolean,"location_category": Database["public"]['Enums']["location_type"] | null,"location_id": string | null,"mode": Database["public"]['Enums']["booking_link_mode"],"not_completed_prompted_at": string | null,"origin_appointment_id": string | null,"patient_id": string,"return_deadline_waived": boolean,"service_id": string,"used_at": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "agenda_id"?: string | null,"appointment_id"?: string | null,"canceled_appointment_id"?: string | null,"clinic_id": string,"contact_id": string,"contact_phone": string,"created_at"?: string,"expires_at": string,"funnel_session_id"?: string | null,"home_visit_address"?: string | null,"id"?: string,"insurance_plan_id"?: string | null,"join_waitlist"?: boolean,"location_category"?: Database["public"]['Enums']["location_type"] | null,"location_id"?: string | null,"mode": Database["public"]['Enums']["booking_link_mode"],"not_completed_prompted_at"?: string | null,"origin_appointment_id"?: string | null,"patient_id": string,"return_deadline_waived"?: boolean,"service_id": string,"used_at"?: string | null
                  }
                  Update: {
                    "agenda_id"?: string | null,"appointment_id"?: string | null,"canceled_appointment_id"?: string | null,"clinic_id"?: string,"contact_id"?: string,"contact_phone"?: string,"created_at"?: string,"expires_at"?: string,"funnel_session_id"?: string | null,"home_visit_address"?: string | null,"id"?: string,"insurance_plan_id"?: string | null,"join_waitlist"?: boolean,"location_category"?: Database["public"]['Enums']["location_type"] | null,"location_id"?: string | null,"mode"?: Database["public"]['Enums']["booking_link_mode"],"not_completed_prompted_at"?: string | null,"origin_appointment_id"?: string | null,"patient_id"?: string,"return_deadline_waived"?: boolean,"service_id"?: string,"used_at"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "booking_links_clinic_id_agenda_id_fkey"
      columns: ["clinic_id","agenda_id"]
isOneToOne: false
      referencedRelation: "agendas"
      referencedColumns: ["clinic_id","id"]
    },{
      foreignKeyName: "booking_links_clinic_id_appointment_id_fkey"
      columns: ["clinic_id","appointment_id"]
isOneToOne: false
      referencedRelation: "appointments"
      referencedColumns: ["clinic_id","id"]
    },{
      foreignKeyName: "booking_links_clinic_id_canceled_appointment_id_fkey"
      columns: ["clinic_id","canceled_appointment_id"]
isOneToOne: false
      referencedRelation: "appointments"
      referencedColumns: ["clinic_id","id"]
    },{
      foreignKeyName: "booking_links_clinic_id_contact_id_fkey"
      columns: ["clinic_id","contact_id"]
isOneToOne: false
      referencedRelation: "contacts"
      referencedColumns: ["clinic_id","id"]
    },{
      foreignKeyName: "booking_links_clinic_id_fkey"
      columns: ["clinic_id"]
isOneToOne: false
      referencedRelation: "clinics"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "booking_links_clinic_id_insurance_plan_id_fkey"
      columns: ["clinic_id","insurance_plan_id"]
isOneToOne: false
      referencedRelation: "insurance_plans"
      referencedColumns: ["clinic_id","id"]
    },{
      foreignKeyName: "booking_links_clinic_id_location_id_fkey"
      columns: ["clinic_id","location_id"]
isOneToOne: false
      referencedRelation: "locations"
      referencedColumns: ["clinic_id","id"]
    },{
      foreignKeyName: "booking_links_clinic_id_origin_appointment_id_fkey"
      columns: ["clinic_id","origin_appointment_id"]
isOneToOne: false
      referencedRelation: "appointments"
      referencedColumns: ["clinic_id","id"]
    },{
      foreignKeyName: "booking_links_clinic_id_patient_id_fkey"
      columns: ["clinic_id","patient_id"]
isOneToOne: false
      referencedRelation: "patients"
      referencedColumns: ["clinic_id","id"]
    },{
      foreignKeyName: "booking_links_clinic_id_service_id_fkey"
      columns: ["clinic_id","service_id"]
isOneToOne: false
      referencedRelation: "services"
      referencedColumns: ["clinic_id","id"]
    }
                  ]
                },"bot_funnel_events": {
                  Row: {
                    "appointment_id": string | null,"clinic_id": string,"contact_id": string | null,"contact_phone": string,"flow": string,"id": number,"metadata": NonNullable<Json>,"occurred_at": string,"session_id": string,"source": string,"step": string
                  }
                  ComputedFields: never
                  Insert: {
                    "appointment_id"?: string | null,"clinic_id": string,"contact_id"?: string | null,"contact_phone": string,"flow": string,"id"?: never,"metadata"?: NonNullable<Json>,"occurred_at"?: string,"session_id": string,"source"?: string,"step": string
                  }
                  Update: {
                    "appointment_id"?: string | null,"clinic_id"?: string,"contact_id"?: string | null,"contact_phone"?: string,"flow"?: string,"id"?: never,"metadata"?: NonNullable<Json>,"occurred_at"?: string,"session_id"?: string,"source"?: string,"step"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "bot_funnel_events_appointment_fk"
      columns: ["clinic_id","appointment_id"]
isOneToOne: false
      referencedRelation: "appointments"
      referencedColumns: ["clinic_id","id"]
    },{
      foreignKeyName: "bot_funnel_events_clinic_id_contact_id_fkey"
      columns: ["clinic_id","contact_id"]
isOneToOne: false
      referencedRelation: "contacts"
      referencedColumns: ["clinic_id","id"]
    },{
      foreignKeyName: "bot_funnel_events_clinic_id_fkey"
      columns: ["clinic_id"]
isOneToOne: false
      referencedRelation: "clinics"
      referencedColumns: ["id"]
    }
                  ]
                },"bot_limit_events": {
                  Row: {
                    "clinic_id": string,"contact_id": string,"created_at": string,"current_value": number,"id": number,"limit_value": number,"paused": boolean,"reason": string
                  }
                  ComputedFields: never
                  Insert: {
                    "clinic_id": string,"contact_id": string,"created_at"?: string,"current_value": number,"id"?: never,"limit_value": number,"paused": boolean,"reason": string
                  }
                  Update: {
                    "clinic_id"?: string,"contact_id"?: string,"created_at"?: string,"current_value"?: number,"id"?: never,"limit_value"?: number,"paused"?: boolean,"reason"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "bot_limit_events_clinic_id_contact_id_fkey"
      columns: ["clinic_id","contact_id"]
isOneToOne: false
      referencedRelation: "contacts"
      referencedColumns: ["clinic_id","id"]
    },{
      foreignKeyName: "bot_limit_events_clinic_id_fkey"
      columns: ["clinic_id"]
isOneToOne: false
      referencedRelation: "clinics"
      referencedColumns: ["id"]
    }
                  ]
                },"bot_messages": {
                  Row: {
                    "body": string,"clinic_id": string,"message_key": string,"updated_at": string,"updated_by": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "body": string,"clinic_id": string,"message_key": string,"updated_at"?: string,"updated_by"?: string | null
                  }
                  Update: {
                    "body"?: string,"clinic_id"?: string,"message_key"?: string,"updated_at"?: string,"updated_by"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "bot_messages_clinic_id_fkey"
      columns: ["clinic_id"]
isOneToOne: false
      referencedRelation: "clinics"
      referencedColumns: ["id"]
    }
                  ]
                },"central_switches": {
                  Row: {
                    "actor_id": string | null,"clinic_id": string,"enabled": boolean,"id": number,"occurred_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "actor_id"?: string | null,"clinic_id": string,"enabled": boolean,"id"?: never,"occurred_at"?: string
                  }
                  Update: {
                    "actor_id"?: string | null,"clinic_id"?: string,"enabled"?: boolean,"id"?: never,"occurred_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "central_switches_clinic_id_fkey"
      columns: ["clinic_id"]
isOneToOne: false
      referencedRelation: "clinics"
      referencedColumns: ["id"]
    }
                  ]
                },"clinic_features": {
                  Row: {
                    "clinic_id": string,"enabled_at": string,"enabled_by": string | null,"feature_key": string
                  }
                  ComputedFields: never
                  Insert: {
                    "clinic_id": string,"enabled_at"?: string,"enabled_by"?: string | null,"feature_key": string
                  }
                  Update: {
                    "clinic_id"?: string,"enabled_at"?: string,"enabled_by"?: string | null,"feature_key"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "clinic_features_clinic_id_fkey"
      columns: ["clinic_id"]
isOneToOne: false
      referencedRelation: "clinics"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "clinic_features_feature_key_fkey"
      columns: ["feature_key"]
isOneToOne: false
      referencedRelation: "features"
      referencedColumns: ["key"]
    }
                  ]
                },"clinic_fiscal_certificates": {
                  Row: {
                    "clinic_id": string,"password_secret_id": string,"pfx_secret_id": string,"subject_cnpj": string,"subject_name": string,"terms_version": string,"uploaded_at": string,"uploaded_by": string | null,"valid_from": string,"valid_until": string
                  }
                  ComputedFields: never
                  Insert: {
                    "clinic_id": string,"password_secret_id": string,"pfx_secret_id": string,"subject_cnpj": string,"subject_name": string,"terms_version": string,"uploaded_at"?: string,"uploaded_by"?: string | null,"valid_from": string,"valid_until": string
                  }
                  Update: {
                    "clinic_id"?: string,"password_secret_id"?: string,"pfx_secret_id"?: string,"subject_cnpj"?: string,"subject_name"?: string,"terms_version"?: string,"uploaded_at"?: string,"uploaded_by"?: string | null,"valid_from"?: string,"valid_until"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "clinic_fiscal_certificates_clinic_id_fkey"
      columns: ["clinic_id"]
isOneToOne: true
      referencedRelation: "clinics"
      referencedColumns: ["id"]
    }
                  ]
                },"clinic_fiscal_settings": {
                  Row: {
                    "clinic_id": string,"cnpj": string,"created_at": string,"environment": string,"iss_rate": number,"legal_name": string,"municipal_registration": string | null,"municipality_ibge": string,"service_code": string,"simples_nacional": string,"simples_regime": string | null,"simples_total_rate": number | null,"special_regime": string,"updated_at": string,"updated_by": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "clinic_id": string,"cnpj": string,"created_at"?: string,"environment"?: string,"iss_rate": number,"legal_name": string,"municipal_registration"?: string | null,"municipality_ibge": string,"service_code": string,"simples_nacional": string,"simples_regime"?: string | null,"simples_total_rate"?: number | null,"special_regime"?: string,"updated_at"?: string,"updated_by"?: string | null
                  }
                  Update: {
                    "clinic_id"?: string,"cnpj"?: string,"created_at"?: string,"environment"?: string,"iss_rate"?: number,"legal_name"?: string,"municipal_registration"?: string | null,"municipality_ibge"?: string,"service_code"?: string,"simples_nacional"?: string,"simples_regime"?: string | null,"simples_total_rate"?: number | null,"special_regime"?: string,"updated_at"?: string,"updated_by"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "clinic_fiscal_settings_clinic_id_fkey"
      columns: ["clinic_id"]
isOneToOne: true
      referencedRelation: "clinics"
      referencedColumns: ["id"]
    }
                  ]
                },"clinic_holidays": {
                  Row: {
                    "clinic_id": string,"created_at": string,"date": string,"description": string,"id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "clinic_id": string,"created_at"?: string,"date": string,"description": string,"id"?: string
                  }
                  Update: {
                    "clinic_id"?: string,"created_at"?: string,"date"?: string,"description"?: string,"id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "clinic_holidays_clinic_id_fkey"
      columns: ["clinic_id"]
isOneToOne: false
      referencedRelation: "clinics"
      referencedColumns: ["id"]
    }
                  ]
                },"clinic_invitations": {
                  Row: {
                    "accepted_at": string | null,"clinic_id": string,"email": string,"id": string,"invited_at": string,"invited_by": string | null,"last_sent_at": string | null,"roles": (Database["public"]['Enums']["clinic_role"])[],"user_id": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "accepted_at"?: string | null,"clinic_id": string,"email": string,"id"?: string,"invited_at"?: string,"invited_by"?: string | null,"last_sent_at"?: string | null,"roles": (Database["public"]['Enums']["clinic_role"])[],"user_id"?: string | null
                  }
                  Update: {
                    "accepted_at"?: string | null,"clinic_id"?: string,"email"?: string,"id"?: string,"invited_at"?: string,"invited_by"?: string | null,"last_sent_at"?: string | null,"roles"?: (Database["public"]['Enums']["clinic_role"])[],"user_id"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "clinic_invitations_clinic_id_fkey"
      columns: ["clinic_id"]
isOneToOne: false
      referencedRelation: "clinics"
      referencedColumns: ["id"]
    }
                  ]
                },"clinic_members": {
                  Row: {
                    "agenda_scope": Database["public"]['Enums']["agenda_scope"],"clinic_id": string,"created_at": string,"display_name": string | null,"roles": (Database["public"]['Enums']["clinic_role"])[],"updated_at": string,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "agenda_scope": Database["public"]['Enums']["agenda_scope"],"clinic_id": string,"created_at"?: string,"display_name"?: string | null,"roles": (Database["public"]['Enums']["clinic_role"])[],"updated_at"?: string,"user_id": string
                  }
                  Update: {
                    "agenda_scope"?: Database["public"]['Enums']["agenda_scope"],"clinic_id"?: string,"created_at"?: string,"display_name"?: string | null,"roles"?: (Database["public"]['Enums']["clinic_role"])[],"updated_at"?: string,"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "clinic_members_clinic_id_fkey"
      columns: ["clinic_id"]
isOneToOne: false
      referencedRelation: "clinics"
      referencedColumns: ["id"]
    }
                  ]
                },"clinic_onboarding_checks": {
                  Row: {
                    "checked_at": string,"checked_by": string | null,"clinic_id": string,"item_key": string
                  }
                  ComputedFields: never
                  Insert: {
                    "checked_at"?: string,"checked_by"?: string | null,"clinic_id": string,"item_key": string
                  }
                  Update: {
                    "checked_at"?: string,"checked_by"?: string | null,"clinic_id"?: string,"item_key"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "clinic_onboarding_checks_clinic_id_fkey"
      columns: ["clinic_id"]
isOneToOne: false
      referencedRelation: "clinics"
      referencedColumns: ["id"]
    }
                  ]
                },"clinic_settings": {
                  Row: {
                    "booking_horizon_days": number,"bot_insurance_info": string | null,"bot_max_future_appointments": number,"bot_max_new_patients": number,"bot_max_no_shows": number,"bot_notes": string | null,"bot_payment_info": string | null,"brand_color": string | null,"clinic_id": string,"consultation_age_limit_years": number | null,"guidance_enabled": boolean,"logo_url": string | null,"message_article": string,"message_noun": string,"message_noun_article": string,"professional_summary_enabled": boolean,"professional_summary_hour": number,"professional_summary_timing": string,"profile": Database["public"]['Enums']["clinic_profile"],"reception_hours": Json | null,"reception_summary_sent_on": string | null,"reminder_enabled": boolean,"reminder_hour": number,"reminder_timing": string,"require_insurance_details": boolean,"team_summary_enabled": boolean,"team_summary_hour": number,"team_summary_timing": string,"timezone": string,"updated_at": string,"website_url": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "booking_horizon_days"?: number,"bot_insurance_info"?: string | null,"bot_max_future_appointments"?: number,"bot_max_new_patients"?: number,"bot_max_no_shows"?: number,"bot_notes"?: string | null,"bot_payment_info"?: string | null,"brand_color"?: string | null,"clinic_id": string,"consultation_age_limit_years"?: number | null,"guidance_enabled"?: boolean,"logo_url"?: string | null,"message_article"?: string,"message_noun"?: string,"message_noun_article"?: string,"professional_summary_enabled"?: boolean,"professional_summary_hour"?: number,"professional_summary_timing"?: string,"profile"?: Database["public"]['Enums']["clinic_profile"],"reception_hours"?: Json | null,"reception_summary_sent_on"?: string | null,"reminder_enabled"?: boolean,"reminder_hour"?: number,"reminder_timing"?: string,"require_insurance_details"?: boolean,"team_summary_enabled"?: boolean,"team_summary_hour"?: number,"team_summary_timing"?: string,"timezone"?: string,"updated_at"?: string,"website_url"?: string | null
                  }
                  Update: {
                    "booking_horizon_days"?: number,"bot_insurance_info"?: string | null,"bot_max_future_appointments"?: number,"bot_max_new_patients"?: number,"bot_max_no_shows"?: number,"bot_notes"?: string | null,"bot_payment_info"?: string | null,"brand_color"?: string | null,"clinic_id"?: string,"consultation_age_limit_years"?: number | null,"guidance_enabled"?: boolean,"logo_url"?: string | null,"message_article"?: string,"message_noun"?: string,"message_noun_article"?: string,"professional_summary_enabled"?: boolean,"professional_summary_hour"?: number,"professional_summary_timing"?: string,"profile"?: Database["public"]['Enums']["clinic_profile"],"reception_hours"?: Json | null,"reception_summary_sent_on"?: string | null,"reminder_enabled"?: boolean,"reminder_hour"?: number,"reminder_timing"?: string,"require_insurance_details"?: boolean,"team_summary_enabled"?: boolean,"team_summary_hour"?: number,"team_summary_timing"?: string,"timezone"?: string,"updated_at"?: string,"website_url"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "clinic_settings_clinic_id_fkey"
      columns: ["clinic_id"]
isOneToOne: true
      referencedRelation: "clinics"
      referencedColumns: ["id"]
    }
                  ]
                },"clinic_usage_monthly": {
                  Row: {
                    "appointments_created": number,"bot_limit_hits": number,"clinic_id": string,"messages_sent": number,"month": string,"templates_sent": number
                  }
                  ComputedFields: never
                  Insert: {
                    "appointments_created"?: number,"bot_limit_hits"?: number,"clinic_id": string,"messages_sent"?: number,"month": string,"templates_sent"?: number
                  }
                  Update: {
                    "appointments_created"?: number,"bot_limit_hits"?: number,"clinic_id"?: string,"messages_sent"?: number,"month"?: string,"templates_sent"?: number
                  }
                  Relationships: [
                    {
      foreignKeyName: "clinic_usage_monthly_clinic_id_fkey"
      columns: ["clinic_id"]
isOneToOne: false
      referencedRelation: "clinics"
      referencedColumns: ["id"]
    }
                  ]
                },"clinics": {
                  Row: {
                    "created_at": string,"id": string,"max_professionals": number,"name": string,"status": Database["public"]['Enums']["clinic_status"],"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"id"?: string,"max_professionals"?: number,"name": string,"status"?: Database["public"]['Enums']["clinic_status"],"updated_at"?: string
                  }
                  Update: {
                    "created_at"?: string,"id"?: string,"max_professionals"?: number,"name"?: string,"status"?: Database["public"]['Enums']["clinic_status"],"updated_at"?: string
                  }
                  Relationships: [
                    
                  ]
                },"contact_finance": {
                  Row: {
                    "clinic_id": string,"contact_id": string,"cpf": string | null,"created_at": string,"updated_at": string,"updated_by": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "clinic_id": string,"contact_id": string,"cpf"?: string | null,"created_at"?: string,"updated_at"?: string,"updated_by"?: string | null
                  }
                  Update: {
                    "clinic_id"?: string,"contact_id"?: string,"cpf"?: string | null,"created_at"?: string,"updated_at"?: string,"updated_by"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "contact_finance_clinic_id_contact_id_fkey"
      columns: ["clinic_id","contact_id"]
isOneToOne: false
      referencedRelation: "contacts"
      referencedColumns: ["clinic_id","id"]
    },{
      foreignKeyName: "contact_finance_clinic_id_fkey"
      columns: ["clinic_id"]
isOneToOne: false
      referencedRelation: "clinics"
      referencedColumns: ["id"]
    }
                  ]
                },"contacts": {
                  Row: {
                    "agenda_import_id": string | null,"anonymized_at": string | null,"bot_blocked_at": string | null,"bot_blocked_by": string | null,"bot_blocked_notified_at": string | null,"bot_blocked_reason": string | null,"bot_limits_exempt_at": string | null,"bot_limits_exempt_by": string | null,"bot_limits_reviewed_at": string | null,"bot_limits_reviewed_by": string | null,"clinic_id": string,"created_at": string,"default_home_address": string | null,"full_name": string,"id": string,"is_active": boolean,"phone": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "agenda_import_id"?: string | null,"anonymized_at"?: string | null,"bot_blocked_at"?: string | null,"bot_blocked_by"?: string | null,"bot_blocked_notified_at"?: string | null,"bot_blocked_reason"?: string | null,"bot_limits_exempt_at"?: string | null,"bot_limits_exempt_by"?: string | null,"bot_limits_reviewed_at"?: string | null,"bot_limits_reviewed_by"?: string | null,"clinic_id": string,"created_at"?: string,"default_home_address"?: string | null,"full_name": string,"id"?: string,"is_active"?: boolean,"phone": string,"updated_at"?: string
                  }
                  Update: {
                    "agenda_import_id"?: string | null,"anonymized_at"?: string | null,"bot_blocked_at"?: string | null,"bot_blocked_by"?: string | null,"bot_blocked_notified_at"?: string | null,"bot_blocked_reason"?: string | null,"bot_limits_exempt_at"?: string | null,"bot_limits_exempt_by"?: string | null,"bot_limits_reviewed_at"?: string | null,"bot_limits_reviewed_by"?: string | null,"clinic_id"?: string,"created_at"?: string,"default_home_address"?: string | null,"full_name"?: string,"id"?: string,"is_active"?: boolean,"phone"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "contacts_agenda_import_id_fkey"
      columns: ["agenda_import_id"]
isOneToOne: false
      referencedRelation: "agenda_import_requests"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "contacts_clinic_id_fkey"
      columns: ["clinic_id"]
isOneToOne: false
      referencedRelation: "clinics"
      referencedColumns: ["id"]
    }
                  ]
                },"conversation_access_log": {
                  Row: {
                    "action": string,"clinic_id": string,"contact_phone": string,"id": number,"media_id": string | null,"occurred_at": string,"user_id": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "action": string,"clinic_id": string,"contact_phone": string,"id"?: never,"media_id"?: string | null,"occurred_at"?: string,"user_id"?: string | null
                  }
                  Update: {
                    "action"?: string,"clinic_id"?: string,"contact_phone"?: string,"id"?: never,"media_id"?: string | null,"occurred_at"?: string,"user_id"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "conversation_access_log_clinic_id_fkey"
      columns: ["clinic_id"]
isOneToOne: false
      referencedRelation: "clinics"
      referencedColumns: ["id"]
    }
                  ]
                },"conversation_reads": {
                  Row: {
                    "clinic_id": string,"contact_phone": string,"last_read_at": string,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "clinic_id": string,"contact_phone": string,"last_read_at"?: string,"user_id": string
                  }
                  Update: {
                    "clinic_id"?: string,"contact_phone"?: string,"last_read_at"?: string,"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "conversation_reads_clinic_id_fkey"
      columns: ["clinic_id"]
isOneToOne: false
      referencedRelation: "clinics"
      referencedColumns: ["id"]
    }
                  ]
                },"conversation_state": {
                  Row: {
                    "assigned_at": string | null,"assigned_to": string | null,"clinic_id": string,"contact_id": string | null,"contact_phone": string,"context": NonNullable<Json>,"funnel_flow": string | null,"funnel_session_id": string | null,"handoff_changed_by": string | null,"handoff_id": string | null,"handoff_notified_at": string | null,"handoff_reason": string | null,"handoff_reminded_at": string | null,"handoff_started_at": string | null,"handoff_status": string | null,"handoff_status_at": string | null,"handoff_subject": string | null,"handoff_subject_asked_at": string | null,"human_handoff": boolean,"human_handoff_at": string | null,"id": string,"last_message_at": string | null,"last_message_author": string | null,"last_message_preview": string | null,"last_patient_at": string | null,"not_understood_count": number,"profile_name": string | null,"state": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "assigned_at"?: string | null,"assigned_to"?: string | null,"clinic_id": string,"contact_id"?: string | null,"contact_phone": string,"context"?: NonNullable<Json>,"funnel_flow"?: string | null,"funnel_session_id"?: string | null,"handoff_changed_by"?: string | null,"handoff_id"?: string | null,"handoff_notified_at"?: string | null,"handoff_reason"?: string | null,"handoff_reminded_at"?: string | null,"handoff_started_at"?: string | null,"handoff_status"?: string | null,"handoff_status_at"?: string | null,"handoff_subject"?: string | null,"handoff_subject_asked_at"?: string | null,"human_handoff"?: boolean,"human_handoff_at"?: string | null,"id"?: string,"last_message_at"?: string | null,"last_message_author"?: string | null,"last_message_preview"?: string | null,"last_patient_at"?: string | null,"not_understood_count"?: number,"profile_name"?: string | null,"state"?: string,"updated_at"?: string
                  }
                  Update: {
                    "assigned_at"?: string | null,"assigned_to"?: string | null,"clinic_id"?: string,"contact_id"?: string | null,"contact_phone"?: string,"context"?: NonNullable<Json>,"funnel_flow"?: string | null,"funnel_session_id"?: string | null,"handoff_changed_by"?: string | null,"handoff_id"?: string | null,"handoff_notified_at"?: string | null,"handoff_reason"?: string | null,"handoff_reminded_at"?: string | null,"handoff_started_at"?: string | null,"handoff_status"?: string | null,"handoff_status_at"?: string | null,"handoff_subject"?: string | null,"handoff_subject_asked_at"?: string | null,"human_handoff"?: boolean,"human_handoff_at"?: string | null,"id"?: string,"last_message_at"?: string | null,"last_message_author"?: string | null,"last_message_preview"?: string | null,"last_patient_at"?: string | null,"not_understood_count"?: number,"profile_name"?: string | null,"state"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "conversation_state_clinic_id_contact_id_fkey"
      columns: ["clinic_id","contact_id"]
isOneToOne: false
      referencedRelation: "contacts"
      referencedColumns: ["clinic_id","id"]
    },{
      foreignKeyName: "conversation_state_clinic_id_fkey"
      columns: ["clinic_id"]
isOneToOne: false
      referencedRelation: "clinics"
      referencedColumns: ["id"]
    }
                  ]
                },"cron_heartbeats": {
                  Row: {
                    "clinics": number,"errors": number,"job": string,"last_finished_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "clinics"?: number,"errors"?: number,"job": string,"last_finished_at": string
                  }
                  Update: {
                    "clinics"?: number,"errors"?: number,"job"?: string,"last_finished_at"?: string
                  }
                  Relationships: [
                    
                  ]
                },"daily_summary_sends": {
                  Row: {
                    "clinic_id": string,"first_scheduled_at": string,"id": number,"kind": string,"professional_id": string | null,"sent_at": string,"summary_date": string,"variant": string
                  }
                  ComputedFields: never
                  Insert: {
                    "clinic_id": string,"first_scheduled_at": string,"id"?: never,"kind": string,"professional_id"?: string | null,"sent_at"?: string,"summary_date": string,"variant"?: string
                  }
                  Update: {
                    "clinic_id"?: string,"first_scheduled_at"?: string,"id"?: never,"kind"?: string,"professional_id"?: string | null,"sent_at"?: string,"summary_date"?: string,"variant"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "daily_summary_sends_clinic_id_fkey"
      columns: ["clinic_id"]
isOneToOne: false
      referencedRelation: "clinics"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "daily_summary_sends_professional_fk"
      columns: ["clinic_id","professional_id"]
isOneToOne: false
      referencedRelation: "professionals"
      referencedColumns: ["clinic_id","id"]
    }
                  ]
                },"features": {
                  Row: {
                    "area": string,"depends_on": (string)[],"key": string,"label": string,"sort_order": number
                  }
                  ComputedFields: never
                  Insert: {
                    "area": string,"depends_on"?: (string)[],"key": string,"label": string,"sort_order": number
                  }
                  Update: {
                    "area"?: string,"depends_on"?: (string)[],"key"?: string,"label"?: string,"sort_order"?: number
                  }
                  Relationships: [
                    
                  ]
                },"fiscal_audit_log": {
                  Row: {
                    "actor_id": string | null,"clinic_id": string,"created_at": string,"details": NonNullable<Json>,"event": string,"id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "actor_id"?: string | null,"clinic_id": string,"created_at"?: string,"details"?: NonNullable<Json>,"event": string,"id"?: string
                  }
                  Update: {
                    "actor_id"?: string | null,"clinic_id"?: string,"created_at"?: string,"details"?: NonNullable<Json>,"event"?: string,"id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "fiscal_audit_log_clinic_id_fkey"
      columns: ["clinic_id"]
isOneToOne: false
      referencedRelation: "clinics"
      referencedColumns: ["id"]
    }
                  ]
                },"handoff_events": {
                  Row: {
                    "actor_id": string | null,"assigned_from": string | null,"assigned_to": string | null,"clinic_id": string,"contact_id": string | null,"contact_phone": string,"from_status": string,"handoff_id": string | null,"id": number,"kind": string,"occurred_at": string,"origin": string,"to_status": string
                  }
                  ComputedFields: never
                  Insert: {
                    "actor_id"?: string | null,"assigned_from"?: string | null,"assigned_to"?: string | null,"clinic_id": string,"contact_id"?: string | null,"contact_phone": string,"from_status": string,"handoff_id"?: string | null,"id"?: never,"kind"?: string,"occurred_at"?: string,"origin": string,"to_status": string
                  }
                  Update: {
                    "actor_id"?: string | null,"assigned_from"?: string | null,"assigned_to"?: string | null,"clinic_id"?: string,"contact_id"?: string | null,"contact_phone"?: string,"from_status"?: string,"handoff_id"?: string | null,"id"?: never,"kind"?: string,"occurred_at"?: string,"origin"?: string,"to_status"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "handoff_events_clinic_id_contact_id_fkey"
      columns: ["clinic_id","contact_id"]
isOneToOne: false
      referencedRelation: "contacts"
      referencedColumns: ["clinic_id","id"]
    },{
      foreignKeyName: "handoff_events_clinic_id_fkey"
      columns: ["clinic_id"]
isOneToOne: false
      referencedRelation: "clinics"
      referencedColumns: ["id"]
    }
                  ]
                },"insurance_plans": {
                  Row: {
                    "alternative_names": (string)[],"ans_code": string | null,"clinic_id": string,"created_at": string,"id": string,"is_active": boolean,"name": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "alternative_names"?: (string)[],"ans_code"?: string | null,"clinic_id": string,"created_at"?: string,"id"?: string,"is_active"?: boolean,"name": string,"updated_at"?: string
                  }
                  Update: {
                    "alternative_names"?: (string)[],"ans_code"?: string | null,"clinic_id"?: string,"created_at"?: string,"id"?: string,"is_active"?: boolean,"name"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "insurance_plans_clinic_id_fkey"
      columns: ["clinic_id"]
isOneToOne: false
      referencedRelation: "clinics"
      referencedColumns: ["id"]
    }
                  ]
                },"job_runs": {
                  Row: {
                    "clinic_id": string,"error_message": string | null,"finished_at": string | null,"id": number,"job": string,"started_at": string,"status": string,"totals": NonNullable<Json>,"trigger": string | null,"variant": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "clinic_id": string,"error_message"?: string | null,"finished_at"?: string | null,"id"?: never,"job": string,"started_at"?: string,"status"?: string,"totals"?: NonNullable<Json>,"trigger"?: string | null,"variant"?: string | null
                  }
                  Update: {
                    "clinic_id"?: string,"error_message"?: string | null,"finished_at"?: string | null,"id"?: never,"job"?: string,"started_at"?: string,"status"?: string,"totals"?: NonNullable<Json>,"trigger"?: string | null,"variant"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "job_runs_clinic_id_fkey"
      columns: ["clinic_id"]
isOneToOne: false
      referencedRelation: "clinics"
      referencedColumns: ["id"]
    }
                  ]
                },"kb_categories": {
                  Row: {
                    "key": string,"label": string,"sort_order": number
                  }
                  ComputedFields: never
                  Insert: {
                    "key": string,"label": string,"sort_order": number
                  }
                  Update: {
                    "key"?: string,"label"?: string,"sort_order"?: number
                  }
                  Relationships: [
                    
                  ]
                },"kb_clinical_terms": {
                  Row: {
                    "id": string,"is_active": boolean,"term": string,"term_group": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "id"?: string,"is_active"?: boolean,"term": string,"term_group": string,"updated_at"?: string
                  }
                  Update: {
                    "id"?: string,"is_active"?: boolean,"term"?: string,"term_group"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    
                  ]
                },"kb_entries": {
                  Row: {
                    "answer_type": Database["public"]['Enums']["kb_answer_type"],"category_key": string,"code": string,"created_at": string,"flow": string | null,"guidance": string,"id": string,"keywords": (string)[],"offers_reception": boolean,"question": string,"required_term": string | null,"sources": (string)[],"status": Database["public"]['Enums']["kb_status"],"template": string | null,"updated_at": string,"updated_by": string | null,"version": number
                  }
                  ComputedFields: never
                  Insert: {
                    "answer_type": Database["public"]['Enums']["kb_answer_type"],"category_key": string,"code": string,"created_at"?: string,"flow"?: string | null,"guidance"?: string,"id"?: string,"keywords"?: (string)[],"offers_reception"?: boolean,"question": string,"required_term"?: string | null,"sources"?: (string)[],"status"?: Database["public"]['Enums']["kb_status"],"template"?: string | null,"updated_at"?: string,"updated_by"?: string | null,"version"?: number
                  }
                  Update: {
                    "answer_type"?: Database["public"]['Enums']["kb_answer_type"],"category_key"?: string,"code"?: string,"created_at"?: string,"flow"?: string | null,"guidance"?: string,"id"?: string,"keywords"?: (string)[],"offers_reception"?: boolean,"question"?: string,"required_term"?: string | null,"sources"?: (string)[],"status"?: Database["public"]['Enums']["kb_status"],"template"?: string | null,"updated_at"?: string,"updated_by"?: string | null,"version"?: number
                  }
                  Relationships: [
                    {
      foreignKeyName: "kb_entries_category_key_fkey"
      columns: ["category_key"]
isOneToOne: false
      referencedRelation: "kb_categories"
      referencedColumns: ["key"]
    }
                  ]
                },"kb_publications": {
                  Row: {
                    "content": NonNullable<Json>,"published_at": string,"published_by": string | null,"version": number
                  }
                  ComputedFields: never
                  Insert: {
                    "content": NonNullable<Json>,"published_at"?: string,"published_by"?: string | null,"version": number
                  }
                  Update: {
                    "content"?: NonNullable<Json>,"published_at"?: string,"published_by"?: string | null,"version"?: number
                  }
                  Relationships: [
                    
                  ]
                },"kb_revisions": {
                  Row: {
                    "actor_user_id": string | null,"entry_id": string | null,"id": number,"new_row": Json | null,"occurred_at": string,"old_row": Json | null,"operation": string,"record_id": string,"table_name": string
                  }
                  ComputedFields: never
                  Insert: {
                    "actor_user_id"?: string | null,"entry_id"?: string | null,"id"?: never,"new_row"?: Json | null,"occurred_at"?: string,"old_row"?: Json | null,"operation": string,"record_id": string,"table_name": string
                  }
                  Update: {
                    "actor_user_id"?: string | null,"entry_id"?: string | null,"id"?: never,"new_row"?: Json | null,"occurred_at"?: string,"old_row"?: Json | null,"operation"?: string,"record_id"?: string,"table_name"?: string
                  }
                  Relationships: [
                    
                  ]
                },"kb_specialties": {
                  Row: {
                    "id": string,"is_active": boolean,"name": string,"terms": (string)[],"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "id"?: string,"is_active"?: boolean,"name": string,"terms"?: (string)[],"updated_at"?: string
                  }
                  Update: {
                    "id"?: string,"is_active"?: boolean,"name"?: string,"terms"?: (string)[],"updated_at"?: string
                  }
                  Relationships: [
                    
                  ]
                },"kb_synonyms": {
                  Row: {
                    "created_at": string,"entry_id": string,"id": string,"text": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"entry_id": string,"id"?: string,"text": string
                  }
                  Update: {
                    "created_at"?: string,"entry_id"?: string,"id"?: string,"text"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "kb_synonyms_entry_id_fkey"
      columns: ["entry_id"]
isOneToOne: false
      referencedRelation: "kb_entries"
      referencedColumns: ["id"]
    }
                  ]
                },"kb_unmatched": {
                  Row: {
                    "clinic_id": string,"conversation_state": string | null,"id": number,"occurred_at": string,"text": string
                  }
                  ComputedFields: never
                  Insert: {
                    "clinic_id": string,"conversation_state"?: string | null,"id"?: never,"occurred_at"?: string,"text": string
                  }
                  Update: {
                    "clinic_id"?: string,"conversation_state"?: string | null,"id"?: never,"occurred_at"?: string,"text"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "kb_unmatched_clinic_id_fkey"
      columns: ["clinic_id"]
isOneToOne: false
      referencedRelation: "clinics"
      referencedColumns: ["id"]
    }
                  ]
                },"known_issues": {
                  Row: {
                    "cause": string,"created_at": string,"id": string,"links": string,"solution": string,"symptom": string,"title": string,"updated_at": string,"updated_by": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "cause"?: string,"created_at"?: string,"id"?: string,"links"?: string,"solution": string,"symptom": string,"title": string,"updated_at"?: string,"updated_by"?: string | null
                  }
                  Update: {
                    "cause"?: string,"created_at"?: string,"id"?: string,"links"?: string,"solution"?: string,"symptom"?: string,"title"?: string,"updated_at"?: string,"updated_by"?: string | null
                  }
                  Relationships: [
                    
                  ]
                },"locations": {
                  Row: {
                    "address": string | null,"clinic_id": string,"created_at": string,"id": string,"is_active": boolean,"name": string,"type": Database["public"]['Enums']["location_type"],"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "address"?: string | null,"clinic_id": string,"created_at"?: string,"id"?: string,"is_active"?: boolean,"name": string,"type": Database["public"]['Enums']["location_type"],"updated_at"?: string
                  }
                  Update: {
                    "address"?: string | null,"clinic_id"?: string,"created_at"?: string,"id"?: string,"is_active"?: boolean,"name"?: string,"type"?: Database["public"]['Enums']["location_type"],"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "locations_clinic_id_fkey"
      columns: ["clinic_id"]
isOneToOne: false
      referencedRelation: "clinics"
      referencedColumns: ["id"]
    }
                  ]
                },"member_agenda_grants": {
                  Row: {
                    "agenda_id": string,"clinic_id": string,"created_at": string,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "agenda_id": string,"clinic_id": string,"created_at"?: string,"user_id": string
                  }
                  Update: {
                    "agenda_id"?: string,"clinic_id"?: string,"created_at"?: string,"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "member_agenda_grants_clinic_id_agenda_id_fkey"
      columns: ["clinic_id","agenda_id"]
isOneToOne: false
      referencedRelation: "agendas"
      referencedColumns: ["clinic_id","id"]
    },{
      foreignKeyName: "member_agenda_grants_clinic_id_fkey"
      columns: ["clinic_id"]
isOneToOne: false
      referencedRelation: "clinics"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "member_agenda_grants_clinic_id_user_id_fkey"
      columns: ["clinic_id","user_id"]
isOneToOne: false
      referencedRelation: "clinic_members"
      referencedColumns: ["clinic_id","user_id"]
    }
                  ]
                },"meta_price_versions": {
                  Row: {
                    "authentication_brl": number,"created_at": string,"created_by": string | null,"free_service_per_month": number,"id": string,"service_brl": number,"source": string,"usd_brl": number,"utility_brl": number,"valid_from": string
                  }
                  ComputedFields: never
                  Insert: {
                    "authentication_brl": number,"created_at"?: string,"created_by"?: string | null,"free_service_per_month": number,"id"?: string,"service_brl": number,"source": string,"usd_brl": number,"utility_brl": number,"valid_from": string
                  }
                  Update: {
                    "authentication_brl"?: number,"created_at"?: string,"created_by"?: string | null,"free_service_per_month"?: number,"id"?: string,"service_brl"?: number,"source"?: string,"usd_brl"?: number,"utility_brl"?: number,"valid_from"?: string
                  }
                  Relationships: [
                    
                  ]
                },"nfse_deliveries": {
                  Row: {
                    "automatic": boolean,"channel": string,"clinic_id": string,"created_at": string,"destination": string,"error": string | null,"id": string,"invoice_id": string,"sent_by": string | null,"status": string,"target": string,"whatsapp_message_id": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "automatic"?: boolean,"channel": string,"clinic_id": string,"created_at"?: string,"destination": string,"error"?: string | null,"id"?: string,"invoice_id": string,"sent_by"?: string | null,"status": string,"target": string,"whatsapp_message_id"?: string | null
                  }
                  Update: {
                    "automatic"?: boolean,"channel"?: string,"clinic_id"?: string,"created_at"?: string,"destination"?: string,"error"?: string | null,"id"?: string,"invoice_id"?: string,"sent_by"?: string | null,"status"?: string,"target"?: string,"whatsapp_message_id"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "nfse_deliveries_clinic_id_fkey"
      columns: ["clinic_id"]
isOneToOne: false
      referencedRelation: "clinics"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "nfse_deliveries_clinic_id_invoice_id_fkey"
      columns: ["clinic_id","invoice_id"]
isOneToOne: false
      referencedRelation: "nfse_invoices"
      referencedColumns: ["clinic_id","id"]
    }
                  ]
                },"nfse_dps_counters": {
                  Row: {
                    "clinic_id": string,"environment": string,"last_number": number
                  }
                  ComputedFields: never
                  Insert: {
                    "clinic_id": string,"environment": string,"last_number": number
                  }
                  Update: {
                    "clinic_id"?: string,"environment"?: string,"last_number"?: number
                  }
                  Relationships: [
                    {
      foreignKeyName: "nfse_dps_counters_clinic_id_fkey"
      columns: ["clinic_id"]
isOneToOne: false
      referencedRelation: "clinics"
      referencedColumns: ["id"]
    }
                  ]
                },"nfse_invoices": {
                  Row: {
                    "access_key": string | null,"cancel_reason_code": number | null,"cancel_reason_text": string | null,"cancel_requested_by": string | null,"canceled_at": string | null,"checked_at": string | null,"clinic_id": string,"dps_id": string,"dps_number": number,"environment": string,"error_code": string | null,"error_message": string | null,"id": string,"issued_at": string | null,"nfse_number": string | null,"payment_id": string,"requested_at": string,"requested_by": string | null,"series": string,"status": string,"xml_path": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "access_key"?: string | null,"cancel_reason_code"?: number | null,"cancel_reason_text"?: string | null,"cancel_requested_by"?: string | null,"canceled_at"?: string | null,"checked_at"?: string | null,"clinic_id": string,"dps_id": string,"dps_number": number,"environment": string,"error_code"?: string | null,"error_message"?: string | null,"id"?: string,"issued_at"?: string | null,"nfse_number"?: string | null,"payment_id": string,"requested_at"?: string,"requested_by"?: string | null,"series": string,"status"?: string,"xml_path"?: string | null
                  }
                  Update: {
                    "access_key"?: string | null,"cancel_reason_code"?: number | null,"cancel_reason_text"?: string | null,"cancel_requested_by"?: string | null,"canceled_at"?: string | null,"checked_at"?: string | null,"clinic_id"?: string,"dps_id"?: string,"dps_number"?: number,"environment"?: string,"error_code"?: string | null,"error_message"?: string | null,"id"?: string,"issued_at"?: string | null,"nfse_number"?: string | null,"payment_id"?: string,"requested_at"?: string,"requested_by"?: string | null,"series"?: string,"status"?: string,"xml_path"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "nfse_invoices_clinic_id_fkey"
      columns: ["clinic_id"]
isOneToOne: false
      referencedRelation: "clinics"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "nfse_invoices_clinic_id_payment_id_fkey"
      columns: ["clinic_id","payment_id"]
isOneToOne: false
      referencedRelation: "payments"
      referencedColumns: ["clinic_id","id"]
    }
                  ]
                },"notification_recipients": {
                  Row: {
                    "clinic_id": string,"created_at": string,"id": string,"is_active": boolean,"label": string,"phone": string,"receives_consultations": boolean,"receives_exams": boolean,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "clinic_id": string,"created_at"?: string,"id"?: string,"is_active"?: boolean,"label": string,"phone": string,"receives_consultations"?: boolean,"receives_exams"?: boolean,"updated_at"?: string
                  }
                  Update: {
                    "clinic_id"?: string,"created_at"?: string,"id"?: string,"is_active"?: boolean,"label"?: string,"phone"?: string,"receives_consultations"?: boolean,"receives_exams"?: boolean,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "notification_recipients_clinic_id_fkey"
      columns: ["clinic_id"]
isOneToOne: false
      referencedRelation: "clinics"
      referencedColumns: ["id"]
    }
                  ]
                },"onboarding_requests": {
                  Row: {
                    "answers": NonNullable<Json>,"clinic_id": string,"email": string,"expires_at": string,"id": string,"requested_at": string,"requested_by": string | null,"reviewed_at": string | null,"reviewed_by": string | null,"saved_at": string | null,"status": string,"submitted_at": string | null,"token_hash": string
                  }
                  ComputedFields: never
                  Insert: {
                    "answers"?: NonNullable<Json>,"clinic_id": string,"email": string,"expires_at": string,"id"?: string,"requested_at"?: string,"requested_by"?: string | null,"reviewed_at"?: string | null,"reviewed_by"?: string | null,"saved_at"?: string | null,"status"?: string,"submitted_at"?: string | null,"token_hash": string
                  }
                  Update: {
                    "answers"?: NonNullable<Json>,"clinic_id"?: string,"email"?: string,"expires_at"?: string,"id"?: string,"requested_at"?: string,"requested_by"?: string | null,"reviewed_at"?: string | null,"reviewed_by"?: string | null,"saved_at"?: string | null,"status"?: string,"submitted_at"?: string | null,"token_hash"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "onboarding_requests_clinic_id_fkey"
      columns: ["clinic_id"]
isOneToOne: false
      referencedRelation: "clinics"
      referencedColumns: ["id"]
    }
                  ]
                },"patient_documents": {
                  Row: {
                    "clinic_id": string,"created_at": string,"created_by": string | null,"description": string | null,"file_name": string,"id": string,"kind": string,"mime_type": string,"patient_id": string,"size_bytes": number,"storage_path": string
                  }
                  ComputedFields: never
                  Insert: {
                    "clinic_id": string,"created_at"?: string,"created_by"?: string | null,"description"?: string | null,"file_name": string,"id"?: string,"kind": string,"mime_type": string,"patient_id": string,"size_bytes": number,"storage_path": string
                  }
                  Update: {
                    "clinic_id"?: string,"created_at"?: string,"created_by"?: string | null,"description"?: string | null,"file_name"?: string,"id"?: string,"kind"?: string,"mime_type"?: string,"patient_id"?: string,"size_bytes"?: number,"storage_path"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "patient_documents_clinic_id_fkey"
      columns: ["clinic_id"]
isOneToOne: false
      referencedRelation: "clinics"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "patient_documents_clinic_id_patient_id_fkey"
      columns: ["clinic_id","patient_id"]
isOneToOne: false
      referencedRelation: "patients"
      referencedColumns: ["clinic_id","id"]
    }
                  ]
                },"patient_finance": {
                  Row: {
                    "clinic_id": string,"cpf": string | null,"created_at": string,"invoice_auto_send": boolean,"invoice_email": string | null,"invoice_phone": string | null,"patient_id": string,"payer": string,"payer_cpf": string | null,"payer_name": string | null,"updated_at": string,"updated_by": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "clinic_id": string,"cpf"?: string | null,"created_at"?: string,"invoice_auto_send"?: boolean,"invoice_email"?: string | null,"invoice_phone"?: string | null,"patient_id": string,"payer"?: string,"payer_cpf"?: string | null,"payer_name"?: string | null,"updated_at"?: string,"updated_by"?: string | null
                  }
                  Update: {
                    "clinic_id"?: string,"cpf"?: string | null,"created_at"?: string,"invoice_auto_send"?: boolean,"invoice_email"?: string | null,"invoice_phone"?: string | null,"patient_id"?: string,"payer"?: string,"payer_cpf"?: string | null,"payer_name"?: string | null,"updated_at"?: string,"updated_by"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "patient_finance_clinic_id_fkey"
      columns: ["clinic_id"]
isOneToOne: false
      referencedRelation: "clinics"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "patient_finance_clinic_id_patient_id_fkey"
      columns: ["clinic_id","patient_id"]
isOneToOne: false
      referencedRelation: "patients"
      referencedColumns: ["clinic_id","id"]
    }
                  ]
                },"patient_notes": {
                  Row: {
                    "body": string,"clinic_id": string,"created_at": string,"created_by": string | null,"from_observations": boolean,"id": string,"patient_id": string,"updated_at": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "body": string,"clinic_id": string,"created_at"?: string,"created_by"?: string | null,"from_observations"?: boolean,"id"?: string,"patient_id": string,"updated_at"?: string | null
                  }
                  Update: {
                    "body"?: string,"clinic_id"?: string,"created_at"?: string,"created_by"?: string | null,"from_observations"?: boolean,"id"?: string,"patient_id"?: string,"updated_at"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "patient_notes_clinic_id_fkey"
      columns: ["clinic_id"]
isOneToOne: false
      referencedRelation: "clinics"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "patient_notes_clinic_id_patient_id_fkey"
      columns: ["clinic_id","patient_id"]
isOneToOne: false
      referencedRelation: "patients"
      referencedColumns: ["clinic_id","id"]
    }
                  ]
                },"patient_reminders": {
                  Row: {
                    "body": string,"clinic_id": string,"created_at": string,"created_by": string | null,"done_at": string | null,"done_by": string | null,"due_on": string,"id": string,"patient_id": string,"updated_at": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "body": string,"clinic_id": string,"created_at"?: string,"created_by"?: string | null,"done_at"?: string | null,"done_by"?: string | null,"due_on": string,"id"?: string,"patient_id": string,"updated_at"?: string | null
                  }
                  Update: {
                    "body"?: string,"clinic_id"?: string,"created_at"?: string,"created_by"?: string | null,"done_at"?: string | null,"done_by"?: string | null,"due_on"?: string,"id"?: string,"patient_id"?: string,"updated_at"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "patient_reminders_clinic_id_fkey"
      columns: ["clinic_id"]
isOneToOne: false
      referencedRelation: "clinics"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "patient_reminders_clinic_id_patient_id_fkey"
      columns: ["clinic_id","patient_id"]
isOneToOne: false
      referencedRelation: "patients"
      referencedColumns: ["clinic_id","id"]
    }
                  ]
                },"patients": {
                  Row: {
                    "agenda_import_id": string | null,"anonymized_at": string | null,"birthdate": string,"clinic_id": string,"contact_id": string,"created_at": string,"created_via": string,"full_name": string,"id": string,"insurance_card_number": string | null,"insurance_card_valid_until": string | null,"insurance_plan_id": string | null,"is_active": boolean,"is_contact_self": boolean,"notes": string | null,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "agenda_import_id"?: string | null,"anonymized_at"?: string | null,"birthdate": string,"clinic_id": string,"contact_id": string,"created_at"?: string,"created_via"?: string,"full_name": string,"id"?: string,"insurance_card_number"?: string | null,"insurance_card_valid_until"?: string | null,"insurance_plan_id"?: string | null,"is_active"?: boolean,"is_contact_self"?: boolean,"notes"?: string | null,"updated_at"?: string
                  }
                  Update: {
                    "agenda_import_id"?: string | null,"anonymized_at"?: string | null,"birthdate"?: string,"clinic_id"?: string,"contact_id"?: string,"created_at"?: string,"created_via"?: string,"full_name"?: string,"id"?: string,"insurance_card_number"?: string | null,"insurance_card_valid_until"?: string | null,"insurance_plan_id"?: string | null,"is_active"?: boolean,"is_contact_self"?: boolean,"notes"?: string | null,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "patients_agenda_import_id_fkey"
      columns: ["agenda_import_id"]
isOneToOne: false
      referencedRelation: "agenda_import_requests"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "patients_clinic_id_contact_id_fkey"
      columns: ["clinic_id","contact_id"]
isOneToOne: false
      referencedRelation: "contacts"
      referencedColumns: ["clinic_id","id"]
    },{
      foreignKeyName: "patients_clinic_id_fkey"
      columns: ["clinic_id"]
isOneToOne: false
      referencedRelation: "clinics"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "patients_clinic_id_insurance_plan_id_fkey"
      columns: ["clinic_id","insurance_plan_id"]
isOneToOne: false
      referencedRelation: "insurance_plans"
      referencedColumns: ["clinic_id","id"]
    }
                  ]
                },"payments": {
                  Row: {
                    "amount_cents": number,"appointment_id": string,"clinic_id": string,"created_at": string,"created_by": string | null,"deleted_at": string | null,"deleted_by": string | null,"id": string,"method": string,"paid_on": string,"patient_id": string,"payer": string,"payer_cpf": string | null,"payer_name": string
                  }
                  ComputedFields: never
                  Insert: {
                    "amount_cents": number,"appointment_id": string,"clinic_id": string,"created_at"?: string,"created_by"?: string | null,"deleted_at"?: string | null,"deleted_by"?: string | null,"id"?: string,"method": string,"paid_on": string,"patient_id": string,"payer": string,"payer_cpf"?: string | null,"payer_name": string
                  }
                  Update: {
                    "amount_cents"?: number,"appointment_id"?: string,"clinic_id"?: string,"created_at"?: string,"created_by"?: string | null,"deleted_at"?: string | null,"deleted_by"?: string | null,"id"?: string,"method"?: string,"paid_on"?: string,"patient_id"?: string,"payer"?: string,"payer_cpf"?: string | null,"payer_name"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "payments_clinic_id_appointment_id_fkey"
      columns: ["clinic_id","appointment_id"]
isOneToOne: false
      referencedRelation: "appointments"
      referencedColumns: ["clinic_id","id"]
    },{
      foreignKeyName: "payments_clinic_id_fkey"
      columns: ["clinic_id"]
isOneToOne: false
      referencedRelation: "clinics"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "payments_clinic_id_patient_id_fkey"
      columns: ["clinic_id","patient_id"]
isOneToOne: false
      referencedRelation: "patients"
      referencedColumns: ["clinic_id","id"]
    }
                  ]
                },"platform_access_log": {
                  Row: {
                    "actor_user_id": string,"clinic_id": string,"id": number,"method": string,"occurred_at": string,"path": string
                  }
                  ComputedFields: never
                  Insert: {
                    "actor_user_id": string,"clinic_id": string,"id"?: never,"method": string,"occurred_at"?: string,"path": string
                  }
                  Update: {
                    "actor_user_id"?: string,"clinic_id"?: string,"id"?: never,"method"?: string,"occurred_at"?: string,"path"?: string
                  }
                  Relationships: [
                    
                  ]
                },"platform_audit_log": {
                  Row: {
                    "actor_user_id": string,"clinic_id": string | null,"id": number,"new_row": Json | null,"occurred_at": string,"old_row": Json | null,"operation": string,"table_name": string
                  }
                  ComputedFields: never
                  Insert: {
                    "actor_user_id": string,"clinic_id"?: string | null,"id"?: never,"new_row"?: Json | null,"occurred_at"?: string,"old_row"?: Json | null,"operation": string,"table_name": string
                  }
                  Update: {
                    "actor_user_id"?: string,"clinic_id"?: string | null,"id"?: never,"new_row"?: Json | null,"occurred_at"?: string,"old_row"?: Json | null,"operation"?: string,"table_name"?: string
                  }
                  Relationships: [
                    
                  ]
                },"platform_settings": {
                  Row: {
                    "id": boolean,"support_whatsapp": string | null,"updated_at": string,"updated_by": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "id"?: boolean,"support_whatsapp"?: string | null,"updated_at"?: string,"updated_by"?: string | null
                  }
                  Update: {
                    "id"?: boolean,"support_whatsapp"?: string | null,"updated_at"?: string,"updated_by"?: string | null
                  }
                  Relationships: [
                    
                  ]
                },"platform_staff": {
                  Row: {
                    "created_at": string,"display_name": string,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"display_name"?: string,"user_id": string
                  }
                  Update: {
                    "created_at"?: string,"display_name"?: string,"user_id"?: string
                  }
                  Relationships: [
                    
                  ]
                },"professional_insurance_exclusions": {
                  Row: {
                    "clinic_id": string,"insurance_plan_id": string,"professional_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "clinic_id": string,"insurance_plan_id": string,"professional_id": string
                  }
                  Update: {
                    "clinic_id"?: string,"insurance_plan_id"?: string,"professional_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "professional_insurance_exclusi_clinic_id_insurance_plan_id_fkey"
      columns: ["clinic_id","insurance_plan_id"]
isOneToOne: false
      referencedRelation: "insurance_plans"
      referencedColumns: ["clinic_id","id"]
    },{
      foreignKeyName: "professional_insurance_exclusion_clinic_id_professional_id_fkey"
      columns: ["clinic_id","professional_id"]
isOneToOne: false
      referencedRelation: "professionals"
      referencedColumns: ["clinic_id","id"]
    },{
      foreignKeyName: "professional_insurance_exclusions_clinic_id_fkey"
      columns: ["clinic_id"]
isOneToOne: false
      referencedRelation: "clinics"
      referencedColumns: ["id"]
    }
                  ]
                },"professionals": {
                  Row: {
                    "clinic_id": string,"council": string | null,"council_number": string | null,"council_state": string | null,"created_at": string,"display_name": string,"id": string,"is_active": boolean,"phone": string | null,"profession": string,"receives_daily_summary": boolean,"rqe": string | null,"specialty": string | null,"updated_at": string,"user_id": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "clinic_id": string,"council"?: string | null,"council_number"?: string | null,"council_state"?: string | null,"created_at"?: string,"display_name": string,"id"?: string,"is_active"?: boolean,"phone"?: string | null,"profession": string,"receives_daily_summary"?: boolean,"rqe"?: string | null,"specialty"?: string | null,"updated_at"?: string,"user_id"?: string | null
                  }
                  Update: {
                    "clinic_id"?: string,"council"?: string | null,"council_number"?: string | null,"council_state"?: string | null,"created_at"?: string,"display_name"?: string,"id"?: string,"is_active"?: boolean,"phone"?: string | null,"profession"?: string,"receives_daily_summary"?: boolean,"rqe"?: string | null,"specialty"?: string | null,"updated_at"?: string,"user_id"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "professionals_clinic_id_fkey"
      columns: ["clinic_id"]
isOneToOne: false
      referencedRelation: "clinics"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "professionals_clinic_id_user_id_fkey"
      columns: ["clinic_id","user_id"]
isOneToOne: false
      referencedRelation: "clinic_members"
      referencedColumns: ["clinic_id","user_id"]
    }
                  ]
                },"push_subscriptions": {
                  Row: {
                    "auth": string,"clinic_id": string,"created_at": string,"device": string | null,"endpoint": string,"id": string,"last_sent_at": string | null,"p256dh": string,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "auth": string,"clinic_id": string,"created_at"?: string,"device"?: string | null,"endpoint": string,"id"?: string,"last_sent_at"?: string | null,"p256dh": string,"user_id": string
                  }
                  Update: {
                    "auth"?: string,"clinic_id"?: string,"created_at"?: string,"device"?: string | null,"endpoint"?: string,"id"?: string,"last_sent_at"?: string | null,"p256dh"?: string,"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "push_subscriptions_clinic_id_fkey"
      columns: ["clinic_id"]
isOneToOne: false
      referencedRelation: "clinics"
      referencedColumns: ["id"]
    }
                  ]
                },"recall_dismissals": {
                  Row: {
                    "clinic_id": string,"dismissed_at": string,"dismissed_by": string | null,"flow_label": string,"phone": string
                  }
                  ComputedFields: never
                  Insert: {
                    "clinic_id": string,"dismissed_at"?: string,"dismissed_by"?: string | null,"flow_label": string,"phone": string
                  }
                  Update: {
                    "clinic_id"?: string,"dismissed_at"?: string,"dismissed_by"?: string | null,"flow_label"?: string,"phone"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "recall_dismissals_clinic_id_fkey"
      columns: ["clinic_id"]
isOneToOne: false
      referencedRelation: "clinics"
      referencedColumns: ["id"]
    }
                  ]
                },"schedule_blocks": {
                  Row: {
                    "agenda_id": string,"clinic_id": string,"created_at": string,"created_by": string | null,"ends_at": string,"id": string,"reason": string,"recess_message": string | null,"removed_at": string | null,"removed_by": string | null,"starts_at": string,"updated_at": string | null,"updated_by": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "agenda_id": string,"clinic_id": string,"created_at"?: string,"created_by"?: string | null,"ends_at": string,"id"?: string,"reason": string,"recess_message"?: string | null,"removed_at"?: string | null,"removed_by"?: string | null,"starts_at": string,"updated_at"?: string | null,"updated_by"?: string | null
                  }
                  Update: {
                    "agenda_id"?: string,"clinic_id"?: string,"created_at"?: string,"created_by"?: string | null,"ends_at"?: string,"id"?: string,"reason"?: string,"recess_message"?: string | null,"removed_at"?: string | null,"removed_by"?: string | null,"starts_at"?: string,"updated_at"?: string | null,"updated_by"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "schedule_blocks_clinic_id_agenda_id_fkey"
      columns: ["clinic_id","agenda_id"]
isOneToOne: false
      referencedRelation: "agendas"
      referencedColumns: ["clinic_id","id"]
    },{
      foreignKeyName: "schedule_blocks_clinic_id_fkey"
      columns: ["clinic_id"]
isOneToOne: false
      referencedRelation: "clinics"
      referencedColumns: ["id"]
    }
                  ]
                },"send_failure_dismissals": {
                  Row: {
                    "clinic_id": string,"dismissed_at": string,"dismissed_by": string | null,"event_id": number | null,"id": number,"message_id": string | null,"scope": string
                  }
                  ComputedFields: never
                  Insert: {
                    "clinic_id": string,"dismissed_at"?: string,"dismissed_by"?: string | null,"event_id"?: number | null,"id"?: never,"message_id"?: string | null,"scope": string
                  }
                  Update: {
                    "clinic_id"?: string,"dismissed_at"?: string,"dismissed_by"?: string | null,"event_id"?: number | null,"id"?: never,"message_id"?: string | null,"scope"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "send_failure_dismissals_clinic_id_fkey"
      columns: ["clinic_id"]
isOneToOne: false
      referencedRelation: "clinics"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "send_failure_dismissals_event_id_fkey"
      columns: ["event_id"]
isOneToOne: false
      referencedRelation: "appointment_events"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "send_failure_dismissals_message_id_fkey"
      columns: ["message_id"]
isOneToOne: false
      referencedRelation: "whatsapp_messages"
      referencedColumns: ["id"]
    }
                  ]
                },"service_agendas": {
                  Row: {
                    "agenda_id": string,"clinic_id": string,"service_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "agenda_id": string,"clinic_id": string,"service_id": string
                  }
                  Update: {
                    "agenda_id"?: string,"clinic_id"?: string,"service_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "service_agendas_clinic_id_agenda_id_fkey"
      columns: ["clinic_id","agenda_id"]
isOneToOne: false
      referencedRelation: "agendas"
      referencedColumns: ["clinic_id","id"]
    },{
      foreignKeyName: "service_agendas_clinic_id_fkey"
      columns: ["clinic_id"]
isOneToOne: false
      referencedRelation: "clinics"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "service_agendas_clinic_id_service_id_fkey"
      columns: ["clinic_id","service_id"]
isOneToOne: false
      referencedRelation: "services"
      referencedColumns: ["clinic_id","id"]
    }
                  ]
                },"service_fiscal_codes": {
                  Row: {
                    "clinic_id": string,"service_code": string,"service_id": string,"updated_at": string,"updated_by": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "clinic_id": string,"service_code": string,"service_id": string,"updated_at"?: string,"updated_by"?: string | null
                  }
                  Update: {
                    "clinic_id"?: string,"service_code"?: string,"service_id"?: string,"updated_at"?: string,"updated_by"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "service_fiscal_codes_clinic_id_fkey"
      columns: ["clinic_id"]
isOneToOne: false
      referencedRelation: "clinics"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "service_fiscal_codes_clinic_id_service_id_fkey"
      columns: ["clinic_id","service_id"]
isOneToOne: false
      referencedRelation: "services"
      referencedColumns: ["clinic_id","id"]
    }
                  ]
                },"service_locations": {
                  Row: {
                    "clinic_id": string,"location_id": string,"price_cents": number | null,"service_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "clinic_id": string,"location_id": string,"price_cents"?: number | null,"service_id": string
                  }
                  Update: {
                    "clinic_id"?: string,"location_id"?: string,"price_cents"?: number | null,"service_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "service_locations_clinic_id_fkey"
      columns: ["clinic_id"]
isOneToOne: false
      referencedRelation: "clinics"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "service_locations_clinic_id_location_id_fkey"
      columns: ["clinic_id","location_id"]
isOneToOne: false
      referencedRelation: "locations"
      referencedColumns: ["clinic_id","id"]
    },{
      foreignKeyName: "service_locations_clinic_id_service_id_fkey"
      columns: ["clinic_id","service_id"]
isOneToOne: false
      referencedRelation: "services"
      referencedColumns: ["clinic_id","id"]
    }
                  ]
                },"services": {
                  Row: {
                    "category": Database["public"]['Enums']["service_category"],"clinic_id": string,"created_at": string,"duration_minutes": number,"id": string,"is_active": boolean,"name": string,"preparation_file_name": string | null,"preparation_file_path": string | null,"preparation_file_size": number | null,"preparation_file_type": string | null,"preparation_instructions": string | null,"price_cents": number,"return_deadline_days": number | null,"scheduling_mode": Database["public"]['Enums']["scheduling_mode"],"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "category": Database["public"]['Enums']["service_category"],"clinic_id": string,"created_at"?: string,"duration_minutes": number,"id"?: string,"is_active"?: boolean,"name": string,"preparation_file_name"?: string | null,"preparation_file_path"?: string | null,"preparation_file_size"?: number | null,"preparation_file_type"?: string | null,"preparation_instructions"?: string | null,"price_cents": number,"return_deadline_days"?: number | null,"scheduling_mode"?: Database["public"]['Enums']["scheduling_mode"],"updated_at"?: string
                  }
                  Update: {
                    "category"?: Database["public"]['Enums']["service_category"],"clinic_id"?: string,"created_at"?: string,"duration_minutes"?: number,"id"?: string,"is_active"?: boolean,"name"?: string,"preparation_file_name"?: string | null,"preparation_file_path"?: string | null,"preparation_file_size"?: number | null,"preparation_file_type"?: string | null,"preparation_instructions"?: string | null,"price_cents"?: number,"return_deadline_days"?: number | null,"scheduling_mode"?: Database["public"]['Enums']["scheduling_mode"],"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "services_clinic_id_fkey"
      columns: ["clinic_id"]
isOneToOne: false
      referencedRelation: "clinics"
      referencedColumns: ["id"]
    }
                  ]
                },"system_errors": {
                  Row: {
                    "clinic_id": string | null,"id": number,"ids": NonNullable<Json>,"message": string,"occurred_at": string,"scope": string
                  }
                  ComputedFields: never
                  Insert: {
                    "clinic_id"?: string | null,"id"?: never,"ids"?: NonNullable<Json>,"message"?: string,"occurred_at"?: string,"scope": string
                  }
                  Update: {
                    "clinic_id"?: string | null,"id"?: never,"ids"?: NonNullable<Json>,"message"?: string,"occurred_at"?: string,"scope"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "system_errors_clinic_id_fkey"
      columns: ["clinic_id"]
isOneToOne: false
      referencedRelation: "clinics"
      referencedColumns: ["id"]
    }
                  ]
                },"waitlist_entries": {
                  Row: {
                    "appointment_id": string,"clinic_id": string,"created_at": string,"created_via": string,"ended_at": string | null,"ended_by": string | null,"ended_reason": string | null,"id": string,"status": string
                  }
                  ComputedFields: never
                  Insert: {
                    "appointment_id": string,"clinic_id": string,"created_at"?: string,"created_via"?: string,"ended_at"?: string | null,"ended_by"?: string | null,"ended_reason"?: string | null,"id"?: string,"status"?: string
                  }
                  Update: {
                    "appointment_id"?: string,"clinic_id"?: string,"created_at"?: string,"created_via"?: string,"ended_at"?: string | null,"ended_by"?: string | null,"ended_reason"?: string | null,"id"?: string,"status"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "waitlist_entries_clinic_id_appointment_id_fkey"
      columns: ["clinic_id","appointment_id"]
isOneToOne: false
      referencedRelation: "appointments"
      referencedColumns: ["clinic_id","id"]
    },{
      foreignKeyName: "waitlist_entries_clinic_id_fkey"
      columns: ["clinic_id"]
isOneToOne: false
      referencedRelation: "clinics"
      referencedColumns: ["id"]
    }
                  ]
                },"waitlist_offers": {
                  Row: {
                    "appointment_id": string,"clinic_id": string,"details": NonNullable<Json>,"entry_id": string,"expires_at": string,"id": string,"offered_at": string,"opened_by_appointment_id": string | null,"opening_id": string | null,"responded_at": string | null,"slot_duration_minutes": number,"slot_location_id": string,"slot_scheduled_at": string,"status": string,"whatsapp_message_id": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "appointment_id": string,"clinic_id": string,"details"?: NonNullable<Json>,"entry_id": string,"expires_at": string,"id"?: string,"offered_at"?: string,"opened_by_appointment_id"?: string | null,"opening_id"?: string | null,"responded_at"?: string | null,"slot_duration_minutes": number,"slot_location_id": string,"slot_scheduled_at": string,"status"?: string,"whatsapp_message_id"?: string | null
                  }
                  Update: {
                    "appointment_id"?: string,"clinic_id"?: string,"details"?: NonNullable<Json>,"entry_id"?: string,"expires_at"?: string,"id"?: string,"offered_at"?: string,"opened_by_appointment_id"?: string | null,"opening_id"?: string | null,"responded_at"?: string | null,"slot_duration_minutes"?: number,"slot_location_id"?: string,"slot_scheduled_at"?: string,"status"?: string,"whatsapp_message_id"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "waitlist_offers_clinic_id_appointment_id_fkey"
      columns: ["clinic_id","appointment_id"]
isOneToOne: false
      referencedRelation: "appointments"
      referencedColumns: ["clinic_id","id"]
    },{
      foreignKeyName: "waitlist_offers_clinic_id_entry_id_fkey"
      columns: ["clinic_id","entry_id"]
isOneToOne: false
      referencedRelation: "waitlist_entries"
      referencedColumns: ["clinic_id","id"]
    },{
      foreignKeyName: "waitlist_offers_clinic_id_fkey"
      columns: ["clinic_id"]
isOneToOne: false
      referencedRelation: "clinics"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "waitlist_offers_clinic_id_opened_by_appointment_id_fkey"
      columns: ["clinic_id","opened_by_appointment_id"]
isOneToOne: false
      referencedRelation: "appointments"
      referencedColumns: ["clinic_id","id"]
    },{
      foreignKeyName: "waitlist_offers_clinic_id_opening_id_fkey"
      columns: ["clinic_id","opening_id"]
isOneToOne: false
      referencedRelation: "waitlist_openings"
      referencedColumns: ["clinic_id","id"]
    },{
      foreignKeyName: "waitlist_offers_clinic_id_slot_location_id_fkey"
      columns: ["clinic_id","slot_location_id"]
isOneToOne: false
      referencedRelation: "locations"
      referencedColumns: ["clinic_id","id"]
    }
                  ]
                },"waitlist_openings": {
                  Row: {
                    "agenda_id": string,"clinic_id": string,"closed_reason": string | null,"created_at": string,"id": string,"is_group_session": boolean,"opened_by_appointment_id": string | null,"reason": string,"service_id": string,"slot_duration_minutes": number,"slot_location_id": string,"slot_scheduled_at": string,"status": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "agenda_id": string,"clinic_id": string,"closed_reason"?: string | null,"created_at"?: string,"id"?: string,"is_group_session"?: boolean,"opened_by_appointment_id"?: string | null,"reason": string,"service_id": string,"slot_duration_minutes": number,"slot_location_id": string,"slot_scheduled_at": string,"status"?: string,"updated_at"?: string
                  }
                  Update: {
                    "agenda_id"?: string,"clinic_id"?: string,"closed_reason"?: string | null,"created_at"?: string,"id"?: string,"is_group_session"?: boolean,"opened_by_appointment_id"?: string | null,"reason"?: string,"service_id"?: string,"slot_duration_minutes"?: number,"slot_location_id"?: string,"slot_scheduled_at"?: string,"status"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "waitlist_openings_clinic_id_agenda_id_fkey"
      columns: ["clinic_id","agenda_id"]
isOneToOne: false
      referencedRelation: "agendas"
      referencedColumns: ["clinic_id","id"]
    },{
      foreignKeyName: "waitlist_openings_clinic_id_fkey"
      columns: ["clinic_id"]
isOneToOne: false
      referencedRelation: "clinics"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "waitlist_openings_clinic_id_opened_by_appointment_id_fkey"
      columns: ["clinic_id","opened_by_appointment_id"]
isOneToOne: false
      referencedRelation: "appointments"
      referencedColumns: ["clinic_id","id"]
    },{
      foreignKeyName: "waitlist_openings_clinic_id_service_id_fkey"
      columns: ["clinic_id","service_id"]
isOneToOne: false
      referencedRelation: "services"
      referencedColumns: ["clinic_id","id"]
    },{
      foreignKeyName: "waitlist_openings_clinic_id_slot_location_id_fkey"
      columns: ["clinic_id","slot_location_id"]
isOneToOne: false
      referencedRelation: "locations"
      referencedColumns: ["clinic_id","id"]
    }
                  ]
                },"whatsapp_connections": {
                  Row: {
                    "access_token_secret_id": string | null,"clinic_id": string,"coexistence": boolean,"connected_at": string | null,"connected_via": string,"contacts_synced_at": string | null,"created_at": string,"disconnected_at": string | null,"disconnected_via": string | null,"display_phone": string | null,"history_synced_at": string | null,"payment_checked_at": string | null,"payment_checked_waba": string | null,"phone_number_id": string,"pin_secret_id": string | null,"status": string,"updated_at": string,"waba_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "access_token_secret_id"?: string | null,"clinic_id": string,"coexistence"?: boolean,"connected_at"?: string | null,"connected_via"?: string,"contacts_synced_at"?: string | null,"created_at"?: string,"disconnected_at"?: string | null,"disconnected_via"?: string | null,"display_phone"?: string | null,"history_synced_at"?: string | null,"payment_checked_at"?: string | null,"payment_checked_waba"?: string | null,"phone_number_id": string,"pin_secret_id"?: string | null,"status"?: string,"updated_at"?: string,"waba_id": string
                  }
                  Update: {
                    "access_token_secret_id"?: string | null,"clinic_id"?: string,"coexistence"?: boolean,"connected_at"?: string | null,"connected_via"?: string,"contacts_synced_at"?: string | null,"created_at"?: string,"disconnected_at"?: string | null,"disconnected_via"?: string | null,"display_phone"?: string | null,"history_synced_at"?: string | null,"payment_checked_at"?: string | null,"payment_checked_waba"?: string | null,"phone_number_id"?: string,"pin_secret_id"?: string | null,"status"?: string,"updated_at"?: string,"waba_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "whatsapp_connections_clinic_id_fkey"
      columns: ["clinic_id"]
isOneToOne: true
      referencedRelation: "clinics"
      referencedColumns: ["id"]
    }
                  ]
                },"whatsapp_history_events": {
                  Row: {
                    "attempts": number,"chunk_order": number | null,"clinic_id": string,"error": string | null,"id": number,"kind": string,"payload": NonNullable<Json>,"phase": number | null,"processed_at": string | null,"progress": number | null,"received_at": string,"status": string
                  }
                  ComputedFields: never
                  Insert: {
                    "attempts"?: number,"chunk_order"?: number | null,"clinic_id": string,"error"?: string | null,"id"?: never,"kind": string,"payload": NonNullable<Json>,"phase"?: number | null,"processed_at"?: string | null,"progress"?: number | null,"received_at"?: string,"status"?: string
                  }
                  Update: {
                    "attempts"?: number,"chunk_order"?: number | null,"clinic_id"?: string,"error"?: string | null,"id"?: never,"kind"?: string,"payload"?: NonNullable<Json>,"phase"?: number | null,"processed_at"?: string | null,"progress"?: number | null,"received_at"?: string,"status"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "whatsapp_history_events_clinic_id_fkey"
      columns: ["clinic_id"]
isOneToOne: false
      referencedRelation: "clinics"
      referencedColumns: ["id"]
    }
                  ]
                },"whatsapp_media": {
                  Row: {
                    "attempts": number,"clinic_id": string,"created_at": string,"deleted_at": string | null,"direction": string,"error": string | null,"file_name": string | null,"id": string,"message_id": string | null,"meta_media_id": string | null,"mime_type": string | null,"sha256": string | null,"size_bytes": number | null,"status": string,"storage_path": string | null,"stored_at": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "attempts"?: number,"clinic_id": string,"created_at"?: string,"deleted_at"?: string | null,"direction": string,"error"?: string | null,"file_name"?: string | null,"id"?: string,"message_id"?: string | null,"meta_media_id"?: string | null,"mime_type"?: string | null,"sha256"?: string | null,"size_bytes"?: number | null,"status"?: string,"storage_path"?: string | null,"stored_at"?: string | null
                  }
                  Update: {
                    "attempts"?: number,"clinic_id"?: string,"created_at"?: string,"deleted_at"?: string | null,"direction"?: string,"error"?: string | null,"file_name"?: string | null,"id"?: string,"message_id"?: string | null,"meta_media_id"?: string | null,"mime_type"?: string | null,"sha256"?: string | null,"size_bytes"?: number | null,"status"?: string,"storage_path"?: string | null,"stored_at"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "whatsapp_media_clinic_id_fkey"
      columns: ["clinic_id"]
isOneToOne: false
      referencedRelation: "clinics"
      referencedColumns: ["id"]
    }
                  ]
                },"whatsapp_messages": {
                  Row: {
                    "appointment_id": string | null,"attempt": number,"author": string,"body": string | null,"client_key": string | null,"clinic_id": string,"contact_id": string | null,"contact_phone": string | null,"created_at": string,"direction": string,"edited_at": string | null,"failure_code": number | null,"failure_reason": string | null,"first_attempt_id": string | null,"handoff_id": string | null,"id": string,"media_id": string | null,"message_type": string,"retry_at": string | null,"retry_payload": Json | null,"revoked_at": string | null,"sent_by": string | null,"sort_at": string,"source": string,"status": string | null,"template_name": string | null,"wa_message_id": string | null,"wa_timestamp": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "appointment_id"?: string | null,"attempt"?: number,"author": string,"body"?: string | null,"client_key"?: string | null,"clinic_id": string,"contact_id"?: string | null,"contact_phone"?: string | null,"created_at"?: string,"direction": string,"edited_at"?: string | null,"failure_code"?: number | null,"failure_reason"?: string | null,"first_attempt_id"?: string | null,"handoff_id"?: string | null,"id"?: string,"media_id"?: string | null,"message_type": string,"retry_at"?: string | null,"retry_payload"?: Json | null,"revoked_at"?: string | null,"sent_by"?: string | null,"sort_at": string,"source"?: string,"status"?: string | null,"template_name"?: string | null,"wa_message_id"?: string | null,"wa_timestamp"?: string | null
                  }
                  Update: {
                    "appointment_id"?: string | null,"attempt"?: number,"author"?: string,"body"?: string | null,"client_key"?: string | null,"clinic_id"?: string,"contact_id"?: string | null,"contact_phone"?: string | null,"created_at"?: string,"direction"?: string,"edited_at"?: string | null,"failure_code"?: number | null,"failure_reason"?: string | null,"first_attempt_id"?: string | null,"handoff_id"?: string | null,"id"?: string,"media_id"?: string | null,"message_type"?: string,"retry_at"?: string | null,"retry_payload"?: Json | null,"revoked_at"?: string | null,"sent_by"?: string | null,"sort_at"?: string,"source"?: string,"status"?: string | null,"template_name"?: string | null,"wa_message_id"?: string | null,"wa_timestamp"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "whatsapp_messages_clinic_id_appointment_id_fkey"
      columns: ["clinic_id","appointment_id"]
isOneToOne: false
      referencedRelation: "appointments"
      referencedColumns: ["clinic_id","id"]
    },{
      foreignKeyName: "whatsapp_messages_clinic_id_contact_id_fkey"
      columns: ["clinic_id","contact_id"]
isOneToOne: false
      referencedRelation: "contacts"
      referencedColumns: ["clinic_id","id"]
    },{
      foreignKeyName: "whatsapp_messages_clinic_id_fkey"
      columns: ["clinic_id"]
isOneToOne: false
      referencedRelation: "clinics"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "whatsapp_messages_first_attempt_id_fkey"
      columns: ["first_attempt_id"]
isOneToOne: false
      referencedRelation: "whatsapp_messages"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "whatsapp_messages_media_fkey"
      columns: ["clinic_id","media_id"]
isOneToOne: false
      referencedRelation: "whatsapp_media"
      referencedColumns: ["clinic_id","id"]
    }
                  ]
                },"whatsapp_templates": {
                  Row: {
                    "body": string | null,"clinic_id": string,"created_at": string,"id": string,"language": string,"meta_template_id": string | null,"name": string,"proposed_at": string | null,"proposed_by": string | null,"rejection_reason": string | null,"stage": string,"status": string,"support_note": string | null,"template_key": string,"updated_at": string,"version": number
                  }
                  ComputedFields: never
                  Insert: {
                    "body"?: string | null,"clinic_id": string,"created_at"?: string,"id"?: string,"language"?: string,"meta_template_id"?: string | null,"name": string,"proposed_at"?: string | null,"proposed_by"?: string | null,"rejection_reason"?: string | null,"stage"?: string,"status"?: string,"support_note"?: string | null,"template_key": string,"updated_at"?: string,"version"?: number
                  }
                  Update: {
                    "body"?: string | null,"clinic_id"?: string,"created_at"?: string,"id"?: string,"language"?: string,"meta_template_id"?: string | null,"name"?: string,"proposed_at"?: string | null,"proposed_by"?: string | null,"rejection_reason"?: string | null,"stage"?: string,"status"?: string,"support_note"?: string | null,"template_key"?: string,"updated_at"?: string,"version"?: number
                  }
                  Relationships: [
                    {
      foreignKeyName: "whatsapp_templates_clinic_id_fkey"
      columns: ["clinic_id"]
isOneToOne: false
      referencedRelation: "clinics"
      referencedColumns: ["id"]
    }
                  ]
                }
          }
          Views: {
            [_ in never]: never
          }
          Functions: {
            "anonymize_patient":
{ Args: { "p_clinic_id": string,"p_patient_id": string }; Returns: Json
                           },
"begin_nfse_cancel":
{ Args: { "p_invoice_id": string,"p_reason_code": number,"p_reason_text": string }; Returns: Json
                           },
"begin_nfse_issue":
{ Args: { "p_payment_id": string }; Returns: Json
                           },
"book_group_session":
{ Args: { "p_agenda_id": string,"p_booking_channel": Database["public"]['Enums']["action_channel"],"p_location_id": string,"p_patient_id": string,"p_scheduled_at": string,"p_service_id": string,"p_trail"?: Json }; Returns: string
                           },
"central_assign":
{ Args: { "p_clinic_id": string,"p_contact_phone": string,"p_expected_assigned": string,"p_to"?: string }; Returns: {
              "assigned_name": string,"assigned_to": string,"outcome": string
            }[]
                           },
"central_conversation_media":
{ Args: { "p_clinic_id": string,"p_contact_phone": string,"p_media_ids": (string)[] }; Returns: {
              "file_name": string,"id": string,"mime_type": string,"size_bytes": number,"status": string
            }[]
                           },
"central_conversation_messages":
{ Args: { "p_before_id"?: string,"p_before_sort_at"?: string,"p_clinic_id": string,"p_contact_phone": string,"p_limit"?: number }; Returns: {
              "author": string,"body": string,"created_at": string,"direction": string,"edited_at": string,"failure_code": number,"failure_reason": string,"handoff_id": string,"id": string,"media_id": string,"message_type": string,"revoked_at": string,"sent_by": string,"sort_at": string,"source": string,"status": string,"template_name": string
            }[]
                           },
"central_conversations":
{ Args: { "p_clinic_id": string,"p_finished"?: boolean,"p_limit"?: number,"p_search"?: string }; Returns: {
              "assigned_name": string,"assigned_to": string,"contact_id": string,"contact_phone": string,"handoff_id": string,"handoff_reason": string,"handoff_started_at": string,"handoff_status": string,"handoff_status_at": string,"handoff_subject": string,"human_handoff": boolean,"last_message_at": string,"last_message_author": string,"last_message_preview": string,"last_patient_at": string,"name": string,"profile_name": string,"unread": number
            }[]
                           },
"central_enabled":
{ Args: { "p_clinic_id": string }; Returns: boolean
                           },
"central_history_process":
{ Args: { "p_clinic_id": string,"p_limit"?: number }; Returns: Json
                           },
"central_media_access":
{ Args: { "p_clinic_id": string,"p_media_id": string }; Returns: {
              "file_name": string,"mime_type": string,"size_bytes": number,"storage_path": string
            }[]
                           },
"central_media_purge_list":
{ Args: { "p_clinic_id": string,"p_limit"?: number }; Returns: {
              "path": string
            }[]
                           },
"central_media_purged":
{ Args: { "p_clinic_id": string,"p_paths": (string)[] }; Returns: number
                           },
"central_media_send_prepare":
{ Args: { "p_caption": string,"p_client_key": string,"p_clinic_id": string,"p_contact_phone": string,"p_expected_assigned": string,"p_file_name": string,"p_mime_type": string,"p_sha256": string,"p_size_bytes": number,"p_storage_path": string }; Returns: {
              "assigned_name": string,"assigned_to": string,"message_id": string,"outcome": string
            }[]
                           },
"central_release_idle":
{ Args: { "p_clinic_id": string,"p_minutes"?: number }; Returns: number
                           },
"central_resume_prepare":
{ Args: { "p_body": string,"p_client_key": string,"p_clinic_id": string,"p_contact_phone": string,"p_expected_assigned": string,"p_template_name": string }; Returns: {
              "assigned_name": string,"assigned_to": string,"message_id": string,"outcome": string
            }[]
                           },
"central_retention":
{ Args: { "p_clinic_id": string,"p_now"?: string }; Returns: Json
                           },
"central_send_prepare":
{ Args: { "p_body": string,"p_client_key": string,"p_clinic_id": string,"p_contact_phone": string,"p_expected_assigned": string }; Returns: {
              "assigned_name": string,"assigned_to": string,"message_id": string,"outcome": string
            }[]
                           },
"central_send_retry":
{ Args: { "p_clinic_id": string,"p_message_id": string }; Returns: {
              "body": string,"contact_phone": string,"outcome": string
            }[]
                           },
"central_team":
{ Args: { "p_clinic_id": string }; Returns: {
              "name": string,"roles": (Database["public"]['Enums']["clinic_role"])[],"user_id": string
            }[]
                           },
"central_waiting_count":
{ Args: { "p_clinic_id": string }; Returns: number
                           },
"change_group_session":
{ Args: { "p_agenda_id": string,"p_appointment_id": string,"p_scheduled_at": string,"p_service_id": string,"p_trail"?: Json }; Returns: undefined
                           },
"clinic_actor_labels":
{ Args: { "p_clinic_id": string,"p_user_ids": (string)[] }; Returns: {
              "is_support": boolean,"name": string,"roles": (Database["public"]['Enums']["clinic_role"])[],"user_id": string
            }[]
                           },
"connect_whatsapp":
{ Args: { "p_clinic_id": string,"p_coexistence": boolean,"p_contacts_synced"?: boolean,"p_display_phone": string,"p_history_synced"?: boolean,"p_phone_number_id": string,"p_pin"?: string,"p_token": string,"p_waba_id": string }; Returns: undefined
                           },
"disconnect_whatsapp":
{ Args: { "p_clinic_id": string }; Returns: boolean
                           },
"dismiss_send_failure":
{ Args: { "p_clinic_id": string,"p_event_id"?: number,"p_message_id"?: string,"p_scope": string }; Returns: undefined
                           },
"finance_patients_missing_payer_cpf":
{ Args: { "p_clinic_id": string }; Returns: {
              "agenda_import_id": string | null,
"anonymized_at": string | null,
"birthdate": string,
"clinic_id": string,
"contact_id": string,
"created_at": string,
"created_via": string,
"full_name": string,
"id": string,
"insurance_card_number": string | null,
"insurance_card_valid_until": string | null,
"insurance_plan_id": string | null,
"is_active": boolean,
"is_contact_self": boolean,
"notes": string | null,
"updated_at": string
            }[]
                          SetofOptions: {
        from: "*"
        to: "patients"
        isOneToOne: false
        isSetofReturn: true
      } },
"find_user_id_by_email":
{ Args: { "p_email": string }; Returns: string
                           },
"finish_nfse_cancel":
{ Args: { "p_error_code"?: string,"p_error_message"?: string,"p_invoice_id": string,"p_outcome": string }; Returns: undefined
                           },
"finish_nfse_issue":
{ Args: { "p_access_key"?: string,"p_error_code"?: string,"p_error_message"?: string,"p_invoice_id": string,"p_nfse_number"?: string,"p_outcome": string,"p_xml_path"?: string }; Returns: undefined
                           },
"get_fiscal_certificate_secret":
{ Args: { "p_clinic_id": string }; Returns: {
              "password": string,"pfx_base64": string
            }[]
                           },
"get_whatsapp_access_token":
{ Args: Record<PropertyKey, never>; Returns: string
                           },
"list_active_clinics":
{ Args: Record<PropertyKey, never>; Returns: string[]
                           },
"list_clinic_member_emails":
{ Args: { "p_clinic_id": string }; Returns: {
              "email": string,"user_id": string
            }[]
                           },
"list_clinics_in_service":
{ Args: Record<PropertyKey, never>; Returns: string[]
                           },
"list_clinics_with_idle_conversations":
{ Args: { "p_before": string }; Returns: string[]
                           },
"list_pending_nfse_invoices":
{ Args: { "p_before": string }; Returns: {
              "access_key": string,"clinic_id": string,"dps_id": string,"environment": string,"invoice_id": string,"status": string
            }[]
                           },
"load_agenda_import":
{ Args: { "p_plan": Json,"p_request_id": string }; Returns: Json
                           },
"log_platform_access":
{ Args: { "p_clinic_id": string,"p_method": string,"p_path": string }; Returns: undefined
                           },
"mark_contact_bot_limits_reviewed":
{ Args: { "p_clinic_id": string,"p_contact_id": string }; Returns: undefined
                           },
"mark_my_invitations_accepted":
{ Args: Record<PropertyKey, never>; Returns: undefined
                           },
"mark_reception_summary_sent":
{ Args: { "p_date": string }; Returns: undefined
                           },
"mark_whatsapp_disconnected_by_meta":
{ Args: Record<PropertyKey, never>; Returns: boolean
                           },
"mark_whatsapp_synced":
{ Args: { "p_clinic_id": string,"p_kind": string }; Returns: undefined
                           },
"meta_message_counts":
{ Args: { "p_clinic_id"?: string,"p_from": string }; Returns: {
              "app_replies": number,"clinic_id": string,"month": string,"service": number,"templates": number
            }[]
                           },
"metrics_activity":
{ Args: { "p_agenda_ids": (string)[],"p_clinic_id": string,"p_end": string,"p_location_ids"?: (string)[],"p_service_ids"?: (string)[],"p_start": string }; Returns: {
              "canceled_clinic": number,"canceled_mass": number,"canceled_patient": number,"created_canceled": number,"created_panel": number,"created_whatsapp": number,"day": string,"rescheduled_patient": number,"rescheduled_team": number,"returns_panel": number,"returns_whatsapp": number,"waitlist_advanced": number
            }[]
                           },
"metrics_attendance":
{ Args: { "p_agenda_ids": (string)[],"p_clinic_id": string,"p_end": string,"p_location_ids"?: (string)[],"p_now"?: string,"p_service_ids"?: (string)[],"p_start": string }; Returns: {
              "canceled": number,"completed": number,"day": string,"location_id": string,"location_name": string,"no_show": number,"scheduled": number,"service_category": Database["public"]['Enums']["service_category"],"service_id": string,"service_name": string,"unregistered": number,"upcoming": number
            }[]
                           },
"metrics_bot_sessions":
{ Args: { "p_clinic_id": string,"p_end": string,"p_start": string }; Returns: {
              "appointment_id": string,"appointment_status": Database["public"]['Enums']["appointment_status"],"contact_id": string,"contact_phone": string,"flow": string,"in_period": boolean,"last_at": string,"last_failure": Json,"session_id": string,"started_at": string,"steps": Json
            }[]
                           },
"metrics_financial":
{ Args: { "p_agenda_ids": (string)[],"p_clinic_id": string,"p_end": string,"p_patient_ids"?: (string)[],"p_start": string }; Returns: {
              "bucket": string,"cents": number,"location_name": string,"service_name": string,"total": number
            }[]
                           },
"metrics_funnel_write_failures":
{ Args: { "p_clinic_id": string,"p_end": string,"p_start": string }; Returns: number
                           },
"metrics_no_shows":
{ Args: { "p_agenda_ids": (string)[],"p_clinic_id": string }; Returns: {
              "contact_name": string,"contact_phone": string,"is_contact_self": boolean,"last_no_show": string,"no_shows": number,"patient_id": string,"patient_name": string,"total": number
            }[]
                           },
"metrics_reminders":
{ Args: { "p_agenda_ids": (string)[],"p_clinic_id": string,"p_end": string,"p_location_ids"?: (string)[],"p_now"?: string,"p_service_ids"?: (string)[],"p_start": string }; Returns: {
              "outcome": string,"status": Database["public"]['Enums']["appointment_status"],"total": number
            }[]
                           },
"metrics_return_rights":
{ Args: { "p_agenda_ids": (string)[],"p_clinic_id": string,"p_end": string,"p_location_ids"?: (string)[],"p_now"?: string,"p_start": string }; Returns: {
              "agenda_id": string,"appointment_id": string,"has_return": boolean,"has_upcoming": boolean,"last_date": string,"patient_id": string,"scheduled_at": string,"status": string
            }[]
                           },
"migrate_agenda":
{ Args: { "p_apply"?: boolean,"p_from": string,"p_services"?: (string)[],"p_to": string }; Returns: Json
                           },
"nfse_delivery_follow_retry":
{ Args: { "p_error": string,"p_message_id": string,"p_previous_message_id": string,"p_sent": boolean }; Returns: undefined
                           },
"nfse_invoice_issued_for_retry":
{ Args: { "p_invoice_id": string }; Returns: boolean
                           },
"publish_knowledge_base":
{ Args: Record<PropertyKey, never>; Returns: number
                           },
"reschedule_group_session":
{ Args: { "p_appointment_id": string,"p_channel": Database["public"]['Enums']["action_channel"],"p_scheduled_at": string,"p_trail"?: Json }; Returns: undefined
                           },
"resolve_agenda_import_clinic":
{ Args: { "p_token_hash": string }; Returns: string
                           },
"resolve_booking_link_clinic":
{ Args: { "p_link_id": string }; Returns: string
                           },
"resolve_onboarding_request_clinic":
{ Args: { "p_token_hash": string }; Returns: string
                           },
"resolve_service_clinic":
{ Args: { "p_service_id": string }; Returns: string
                           },
"resolve_whatsapp_clinic":
{ Args: { "p_phone_number_id": string }; Returns: string
                           },
"resolve_whatsapp_clinics_by_waba":
{ Args: { "p_waba_id": string }; Returns: string[]
                           },
"revoke_fiscal_certificate":
{ Args: { "p_clinic_id": string }; Returns: undefined
                           },
"search_contact_ids":
{ Args: { "p_clinic_id": string,"p_include_inactive"?: boolean,"p_limit"?: number,"p_query": string }; Returns: {
              "id": string,"score": number
            }[]
                           },
"search_insurance_plans":
{ Args: { "p_clinic_id": string,"p_query": string }; Returns: {
              "id": string,"name": string,"score": number
            }[]
                           },
"search_patient_ids":
{ Args: { "p_clinic_id": string,"p_include_inactive"?: boolean,"p_limit"?: number,"p_query": string }; Returns: {
              "id": string,"score": number
            }[]
                           },
"set_central_enabled":
{ Args: { "p_clinic_id": string,"p_enabled": boolean }; Returns: boolean
                           },
"set_clinic_features":
{ Args: { "p_clinic_id": string,"p_features": (string)[] }; Returns: undefined
                           },
"set_clinic_professional_limit":
{ Args: { "p_clinic_id": string,"p_limit": number }; Returns: undefined
                           },
"set_contact_bot_blocked":
{ Args: { "p_blocked": boolean,"p_clinic_id": string,"p_contact_id": string,"p_reason"?: string }; Returns: undefined
                           },
"set_contact_bot_limits_exempt":
{ Args: { "p_clinic_id": string,"p_contact_id": string,"p_exempt": boolean }; Returns: undefined
                           },
"set_fiscal_certificate":
{ Args: { "p_clinic_id": string,"p_password": string,"p_pfx_base64": string,"p_subject_cnpj": string,"p_subject_name": string,"p_terms_version": string,"p_valid_from": string,"p_valid_until": string }; Returns: undefined
                           },
"set_scheduler_settings":
{ Args: { "p_base_url": string,"p_cron_secret": string }; Returns: undefined
                           },
"set_whatsapp_access_token":
{ Args: { "p_clinic_id": string,"p_token": string }; Returns: undefined
                           },
"set_whatsapp_payment_checked":
{ Args: { "p_checked": boolean,"p_clinic_id": string }; Returns: undefined
                           },
"similar_contact_ids":
{ Args: { "p_clinic_id": string,"p_name": string }; Returns: string[]
                           },
"similar_patient_ids":
{ Args: { "p_clinic_id": string,"p_contact_id"?: string,"p_name": string }; Returns: string[]
                           },
"support_latest_messages":
{ Args: { "p_clinic_id": string,"p_limit"?: number }; Returns: {
              "appointment_id": string,"body": string,"contact_id": string,"contact_phone": string,"created_at": string,"direction": string,"id": string,"message_type": string,"status": string,"template_name": string
            }[]
                           },
"undo_agenda_import":
{ Args: { "p_apply": boolean,"p_request_id": string }; Returns: Json
                           }
          }
          Enums: {
            "action_channel": "admin"|"whatsapp_bot","agenda_kind": "professional"|"resource","agenda_scope": "all"|"restricted","appointment_status": "scheduled"|"confirmed"|"completed"|"canceled"|"no_show","booking_link_mode": "create"|"reschedule","clinic_profile": "pediatric"|"adult"|"mixed","clinic_role": "admin"|"professional"|"reception","clinic_status": "active"|"suspended"|"onboarding","kb_answer_type": "template"|"source"|"flow"|"fixed"|"reception","kb_status": "draft"|"approved"|"active"|"inactive","location_type": "clinic"|"home_visit","scheduling_mode": "individual"|"group","series_skip_reason": "holiday"|"block"|"conflict","service_category": "consultation"|"return_visit"|"exam"
          }
          CompositeTypes: {
            [_ in never]: never
          }
        }
}

type DatabaseWithoutInternals = Omit<Database, '__InternalSupabase'>

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
  ? (DefaultSchema["Tables"] & DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
      Row: infer R
    }
    ? R
    : never
  : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
  ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
      Insert: infer I
    }
    ? I
    : never
  : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
  ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
      Update: infer U
    }
    ? U
    : never
  : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never
> = DefaultSchemaEnumNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
  ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
  : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never
> = PublicCompositeTypeNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
  ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
  : never

export const Constants = {
  "public": {
          Enums: {
            "action_channel": ["admin", "whatsapp_bot"],"agenda_kind": ["professional", "resource"],"agenda_scope": ["all", "restricted"],"appointment_status": ["scheduled", "confirmed", "completed", "canceled", "no_show"],"booking_link_mode": ["create", "reschedule"],"clinic_profile": ["pediatric", "adult", "mixed"],"clinic_role": ["admin", "professional", "reception"],"clinic_status": ["active", "suspended", "onboarding"],"kb_answer_type": ["template", "source", "flow", "fixed", "reception"],"kb_status": ["draft", "approved", "active", "inactive"],"location_type": ["clinic", "home_visit"],"scheduling_mode": ["individual", "group"],"series_skip_reason": ["holiday", "block", "conflict"],"service_category": ["consultation", "return_visit", "exam"]
          }
        }
} as const

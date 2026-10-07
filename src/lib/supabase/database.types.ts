
export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]

export type Database = {
  
  "public": {
          Tables: {
            "agendas": {
                  Row: {
                    "buffer_minutes": number,"clinic_id": string,"created_at": string,"id": string,"is_active": boolean,"kind": Database["public"]['Enums']["agenda_kind"],"name": string,"professional_id": string | null,"updated_at": string
                  }
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
                    "agenda_id": string,"booking_channel": Database["public"]['Enums']["action_channel"],"canceled_at": string | null,"canceled_by": string | null,"canceled_via": Database["public"]['Enums']["action_channel"] | null,"clinic_id": string,"confirmed_at": string | null,"created_at": string,"created_by": string | null,"duration_minutes": number,"home_visit_address": string | null,"id": string,"insurance_plan_id": string | null,"is_group_session": boolean,"location_id": string,"mass_canceled": boolean,"origin_appointment_id": string | null,"patient_confirmed_at": string | null,"patient_confirmed_by": string | null,"patient_id": string,"price_cents": number | null,"rebooking_dismissed_at": string | null,"reminder_response": string | null,"reminder_response_at": string | null,"reminder_sent_at": string | null,"rescheduled_at": string | null,"rescheduled_by": string | null,"rescheduled_via": Database["public"]['Enums']["action_channel"] | null,"scheduled_at": string,"series_id": string | null,"service_id": string,"status": Database["public"]['Enums']["appointment_status"],"updated_at": string
                  }
                  Insert: {
                    "agenda_id": string,"booking_channel": Database["public"]['Enums']["action_channel"],"canceled_at"?: string | null,"canceled_by"?: string | null,"canceled_via"?: Database["public"]['Enums']["action_channel"] | null,"clinic_id": string,"confirmed_at"?: string | null,"created_at"?: string,"created_by"?: string | null,"duration_minutes": number,"home_visit_address"?: string | null,"id"?: string,"insurance_plan_id"?: string | null,"is_group_session"?: boolean,"location_id": string,"mass_canceled"?: boolean,"origin_appointment_id"?: string | null,"patient_confirmed_at"?: string | null,"patient_confirmed_by"?: string | null,"patient_id": string,"price_cents"?: number | null,"rebooking_dismissed_at"?: string | null,"reminder_response"?: string | null,"reminder_response_at"?: string | null,"reminder_sent_at"?: string | null,"rescheduled_at"?: string | null,"rescheduled_by"?: string | null,"rescheduled_via"?: Database["public"]['Enums']["action_channel"] | null,"scheduled_at": string,"series_id"?: string | null,"service_id": string,"status"?: Database["public"]['Enums']["appointment_status"],"updated_at"?: string
                  }
                  Update: {
                    "agenda_id"?: string,"booking_channel"?: Database["public"]['Enums']["action_channel"],"canceled_at"?: string | null,"canceled_by"?: string | null,"canceled_via"?: Database["public"]['Enums']["action_channel"] | null,"clinic_id"?: string,"confirmed_at"?: string | null,"created_at"?: string,"created_by"?: string | null,"duration_minutes"?: number,"home_visit_address"?: string | null,"id"?: string,"insurance_plan_id"?: string | null,"is_group_session"?: boolean,"location_id"?: string,"mass_canceled"?: boolean,"origin_appointment_id"?: string | null,"patient_confirmed_at"?: string | null,"patient_confirmed_by"?: string | null,"patient_id"?: string,"price_cents"?: number | null,"rebooking_dismissed_at"?: string | null,"reminder_response"?: string | null,"reminder_response_at"?: string | null,"reminder_sent_at"?: string | null,"rescheduled_at"?: string | null,"rescheduled_by"?: string | null,"rescheduled_via"?: Database["public"]['Enums']["action_channel"] | null,"scheduled_at"?: string,"series_id"?: string | null,"service_id"?: string,"status"?: Database["public"]['Enums']["appointment_status"],"updated_at"?: string
                  }
                  Relationships: [
                    {
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
                    "agenda_id": string | null,"appointment_id": string | null,"canceled_appointment_id": string | null,"clinic_id": string,"contact_id": string,"contact_phone": string,"created_at": string,"expires_at": string,"funnel_session_id": string | null,"home_visit_address": string | null,"id": string,"join_waitlist": boolean,"location_category": Database["public"]['Enums']["location_type"] | null,"location_id": string | null,"mode": Database["public"]['Enums']["booking_link_mode"],"origin_appointment_id": string | null,"patient_id": string,"return_deadline_waived": boolean,"service_id": string,"used_at": string | null
                  }
                  Insert: {
                    "agenda_id"?: string | null,"appointment_id"?: string | null,"canceled_appointment_id"?: string | null,"clinic_id": string,"contact_id": string,"contact_phone": string,"created_at"?: string,"expires_at": string,"funnel_session_id"?: string | null,"home_visit_address"?: string | null,"id"?: string,"join_waitlist"?: boolean,"location_category"?: Database["public"]['Enums']["location_type"] | null,"location_id"?: string | null,"mode": Database["public"]['Enums']["booking_link_mode"],"origin_appointment_id"?: string | null,"patient_id": string,"return_deadline_waived"?: boolean,"service_id": string,"used_at"?: string | null
                  }
                  Update: {
                    "agenda_id"?: string | null,"appointment_id"?: string | null,"canceled_appointment_id"?: string | null,"clinic_id"?: string,"contact_id"?: string,"contact_phone"?: string,"created_at"?: string,"expires_at"?: string,"funnel_session_id"?: string | null,"home_visit_address"?: string | null,"id"?: string,"join_waitlist"?: boolean,"location_category"?: Database["public"]['Enums']["location_type"] | null,"location_id"?: string | null,"mode"?: Database["public"]['Enums']["booking_link_mode"],"origin_appointment_id"?: string | null,"patient_id"?: string,"return_deadline_waived"?: boolean,"service_id"?: string,"used_at"?: string | null
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
                    "clinic_id": string,"contact_id": string | null,"contact_phone": string,"flow": string,"id": number,"metadata": NonNullable<Json>,"occurred_at": string,"session_id": string,"source": string,"step": string
                  }
                  Insert: {
                    "clinic_id": string,"contact_id"?: string | null,"contact_phone": string,"flow": string,"id"?: never,"metadata"?: NonNullable<Json>,"occurred_at"?: string,"session_id": string,"source"?: string,"step": string
                  }
                  Update: {
                    "clinic_id"?: string,"contact_id"?: string | null,"contact_phone"?: string,"flow"?: string,"id"?: never,"metadata"?: NonNullable<Json>,"occurred_at"?: string,"session_id"?: string,"source"?: string,"step"?: string
                  }
                  Relationships: [
                    {
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
                },"clinic_features": {
                  Row: {
                    "clinic_id": string,"enabled_at": string,"enabled_by": string | null,"feature_key": string
                  }
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
                },"clinic_holidays": {
                  Row: {
                    "clinic_id": string,"created_at": string,"date": string,"description": string,"id": string
                  }
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
                },"clinic_settings": {
                  Row: {
                    "bot_insurance_info": string | null,"bot_notes": string | null,"bot_payment_info": string | null,"brand_color": string | null,"clinic_id": string,"consultation_age_limit_years": number | null,"logo_url": string | null,"message_article": string,"profile": Database["public"]['Enums']["clinic_profile"],"reminder_hour": number,"require_insurance_details": boolean,"timezone": string,"updated_at": string,"website_url": string | null
                  }
                  Insert: {
                    "bot_insurance_info"?: string | null,"bot_notes"?: string | null,"bot_payment_info"?: string | null,"brand_color"?: string | null,"clinic_id": string,"consultation_age_limit_years"?: number | null,"logo_url"?: string | null,"message_article"?: string,"profile"?: Database["public"]['Enums']["clinic_profile"],"reminder_hour"?: number,"require_insurance_details"?: boolean,"timezone"?: string,"updated_at"?: string,"website_url"?: string | null
                  }
                  Update: {
                    "bot_insurance_info"?: string | null,"bot_notes"?: string | null,"bot_payment_info"?: string | null,"brand_color"?: string | null,"clinic_id"?: string,"consultation_age_limit_years"?: number | null,"logo_url"?: string | null,"message_article"?: string,"profile"?: Database["public"]['Enums']["clinic_profile"],"reminder_hour"?: number,"require_insurance_details"?: boolean,"timezone"?: string,"updated_at"?: string,"website_url"?: string | null
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
                    "appointments_created": number,"clinic_id": string,"messages_sent": number,"month": string
                  }
                  Insert: {
                    "appointments_created"?: number,"clinic_id": string,"messages_sent"?: number,"month": string
                  }
                  Update: {
                    "appointments_created"?: number,"clinic_id"?: string,"messages_sent"?: number,"month"?: string
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
                  Insert: {
                    "created_at"?: string,"id"?: string,"max_professionals"?: number,"name": string,"status"?: Database["public"]['Enums']["clinic_status"],"updated_at"?: string
                  }
                  Update: {
                    "created_at"?: string,"id"?: string,"max_professionals"?: number,"name"?: string,"status"?: Database["public"]['Enums']["clinic_status"],"updated_at"?: string
                  }
                  Relationships: [
                    
                  ]
                },"contacts": {
                  Row: {
                    "clinic_id": string,"created_at": string,"default_home_address": string | null,"full_name": string,"id": string,"is_active": boolean,"phone": string,"updated_at": string
                  }
                  Insert: {
                    "clinic_id": string,"created_at"?: string,"default_home_address"?: string | null,"full_name": string,"id"?: string,"is_active"?: boolean,"phone": string,"updated_at"?: string
                  }
                  Update: {
                    "clinic_id"?: string,"created_at"?: string,"default_home_address"?: string | null,"full_name"?: string,"id"?: string,"is_active"?: boolean,"phone"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "contacts_clinic_id_fkey"
      columns: ["clinic_id"]
isOneToOne: false
      referencedRelation: "clinics"
      referencedColumns: ["id"]
    }
                  ]
                },"conversation_state": {
                  Row: {
                    "clinic_id": string,"contact_id": string | null,"contact_phone": string,"context": NonNullable<Json>,"funnel_flow": string | null,"funnel_session_id": string | null,"human_handoff": boolean,"human_handoff_at": string | null,"id": string,"state": string,"updated_at": string
                  }
                  Insert: {
                    "clinic_id": string,"contact_id"?: string | null,"contact_phone": string,"context"?: NonNullable<Json>,"funnel_flow"?: string | null,"funnel_session_id"?: string | null,"human_handoff"?: boolean,"human_handoff_at"?: string | null,"id"?: string,"state"?: string,"updated_at"?: string
                  }
                  Update: {
                    "clinic_id"?: string,"contact_id"?: string | null,"contact_phone"?: string,"context"?: NonNullable<Json>,"funnel_flow"?: string | null,"funnel_session_id"?: string | null,"human_handoff"?: boolean,"human_handoff_at"?: string | null,"id"?: string,"state"?: string,"updated_at"?: string
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
                },"daily_summary_sends": {
                  Row: {
                    "clinic_id": string,"first_scheduled_at": string,"id": number,"kind": string,"professional_id": string | null,"sent_at": string,"summary_date": string,"variant": string
                  }
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
                  Insert: {
                    "area": string,"depends_on"?: (string)[],"key": string,"label": string,"sort_order": number
                  }
                  Update: {
                    "area"?: string,"depends_on"?: (string)[],"key"?: string,"label"?: string,"sort_order"?: number
                  }
                  Relationships: [
                    
                  ]
                },"insurance_plans": {
                  Row: {
                    "alternative_names": (string)[],"ans_code": string | null,"clinic_id": string,"created_at": string,"id": string,"is_active": boolean,"name": string,"updated_at": string
                  }
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
                },"locations": {
                  Row: {
                    "address": string | null,"clinic_id": string,"created_at": string,"id": string,"is_active": boolean,"name": string,"type": Database["public"]['Enums']["location_type"],"updated_at": string
                  }
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
                },"notification_recipients": {
                  Row: {
                    "clinic_id": string,"created_at": string,"id": string,"is_active": boolean,"label": string,"phone": string,"receives_consultations": boolean,"receives_exams": boolean,"updated_at": string
                  }
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
                },"patients": {
                  Row: {
                    "birthdate": string,"clinic_id": string,"contact_id": string,"created_at": string,"full_name": string,"id": string,"insurance_card_number": string | null,"insurance_card_valid_until": string | null,"insurance_plan_id": string | null,"is_active": boolean,"is_contact_self": boolean,"notes": string | null,"updated_at": string
                  }
                  Insert: {
                    "birthdate": string,"clinic_id": string,"contact_id": string,"created_at"?: string,"full_name": string,"id"?: string,"insurance_card_number"?: string | null,"insurance_card_valid_until"?: string | null,"insurance_plan_id"?: string | null,"is_active"?: boolean,"is_contact_self"?: boolean,"notes"?: string | null,"updated_at"?: string
                  }
                  Update: {
                    "birthdate"?: string,"clinic_id"?: string,"contact_id"?: string,"created_at"?: string,"full_name"?: string,"id"?: string,"insurance_card_number"?: string | null,"insurance_card_valid_until"?: string | null,"insurance_plan_id"?: string | null,"is_active"?: boolean,"is_contact_self"?: boolean,"notes"?: string | null,"updated_at"?: string
                  }
                  Relationships: [
                    {
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
                },"platform_access_log": {
                  Row: {
                    "actor_user_id": string,"clinic_id": string,"id": number,"method": string,"occurred_at": string,"path": string
                  }
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
                  Insert: {
                    "actor_user_id": string,"clinic_id"?: string | null,"id"?: never,"new_row"?: Json | null,"occurred_at"?: string,"old_row"?: Json | null,"operation": string,"table_name": string
                  }
                  Update: {
                    "actor_user_id"?: string,"clinic_id"?: string | null,"id"?: never,"new_row"?: Json | null,"occurred_at"?: string,"old_row"?: Json | null,"operation"?: string,"table_name"?: string
                  }
                  Relationships: [
                    
                  ]
                },"platform_staff": {
                  Row: {
                    "created_at": string,"display_name": string,"user_id": string
                  }
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
                },"schedule_blocks": {
                  Row: {
                    "agenda_id": string,"clinic_id": string,"created_at": string,"created_by": string | null,"ends_at": string,"id": string,"reason": string,"removed_at": string | null,"removed_by": string | null,"starts_at": string,"updated_at": string | null,"updated_by": string | null
                  }
                  Insert: {
                    "agenda_id": string,"clinic_id": string,"created_at"?: string,"created_by"?: string | null,"ends_at": string,"id"?: string,"reason": string,"removed_at"?: string | null,"removed_by"?: string | null,"starts_at": string,"updated_at"?: string | null,"updated_by"?: string | null
                  }
                  Update: {
                    "agenda_id"?: string,"clinic_id"?: string,"created_at"?: string,"created_by"?: string | null,"ends_at"?: string,"id"?: string,"reason"?: string,"removed_at"?: string | null,"removed_by"?: string | null,"starts_at"?: string,"updated_at"?: string | null,"updated_by"?: string | null
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
                },"service_agendas": {
                  Row: {
                    "agenda_id": string,"clinic_id": string,"service_id": string
                  }
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
                },"service_locations": {
                  Row: {
                    "clinic_id": string,"location_id": string,"price_cents": number | null,"service_id": string
                  }
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
                    "category": Database["public"]['Enums']["service_category"],"clinic_id": string,"created_at": string,"duration_minutes": number,"id": string,"is_active": boolean,"name": string,"preparation_instructions": string | null,"price_cents": number,"return_deadline_days": number | null,"scheduling_mode": Database["public"]['Enums']["scheduling_mode"],"updated_at": string
                  }
                  Insert: {
                    "category": Database["public"]['Enums']["service_category"],"clinic_id": string,"created_at"?: string,"duration_minutes": number,"id"?: string,"is_active"?: boolean,"name": string,"preparation_instructions"?: string | null,"price_cents": number,"return_deadline_days"?: number | null,"scheduling_mode"?: Database["public"]['Enums']["scheduling_mode"],"updated_at"?: string
                  }
                  Update: {
                    "category"?: Database["public"]['Enums']["service_category"],"clinic_id"?: string,"created_at"?: string,"duration_minutes"?: number,"id"?: string,"is_active"?: boolean,"name"?: string,"preparation_instructions"?: string | null,"price_cents"?: number,"return_deadline_days"?: number | null,"scheduling_mode"?: Database["public"]['Enums']["scheduling_mode"],"updated_at"?: string
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
                },"waitlist_entries": {
                  Row: {
                    "appointment_id": string,"clinic_id": string,"created_at": string,"created_via": string,"ended_at": string | null,"ended_by": string | null,"ended_reason": string | null,"id": string,"status": string
                  }
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
                    "access_token_secret_id": string | null,"clinic_id": string,"connected_at": string | null,"created_at": string,"display_phone": string | null,"phone_number_id": string,"status": string,"updated_at": string,"waba_id": string
                  }
                  Insert: {
                    "access_token_secret_id"?: string | null,"clinic_id": string,"connected_at"?: string | null,"created_at"?: string,"display_phone"?: string | null,"phone_number_id": string,"status"?: string,"updated_at"?: string,"waba_id": string
                  }
                  Update: {
                    "access_token_secret_id"?: string | null,"clinic_id"?: string,"connected_at"?: string | null,"created_at"?: string,"display_phone"?: string | null,"phone_number_id"?: string,"status"?: string,"updated_at"?: string,"waba_id"?: string
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
                },"whatsapp_messages": {
                  Row: {
                    "appointment_id": string | null,"body": string | null,"clinic_id": string,"contact_id": string | null,"contact_phone": string | null,"created_at": string,"direction": string,"id": string,"message_type": string,"status": string | null,"template_name": string | null,"wa_message_id": string | null
                  }
                  Insert: {
                    "appointment_id"?: string | null,"body"?: string | null,"clinic_id": string,"contact_id"?: string | null,"contact_phone"?: string | null,"created_at"?: string,"direction": string,"id"?: string,"message_type": string,"status"?: string | null,"template_name"?: string | null,"wa_message_id"?: string | null
                  }
                  Update: {
                    "appointment_id"?: string | null,"body"?: string | null,"clinic_id"?: string,"contact_id"?: string | null,"contact_phone"?: string | null,"created_at"?: string,"direction"?: string,"id"?: string,"message_type"?: string,"status"?: string | null,"template_name"?: string | null,"wa_message_id"?: string | null
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
    }
                  ]
                },"whatsapp_templates": {
                  Row: {
                    "clinic_id": string,"created_at": string,"id": string,"language": string,"meta_template_id": string | null,"name": string,"rejection_reason": string | null,"status": string,"template_key": string,"updated_at": string
                  }
                  Insert: {
                    "clinic_id": string,"created_at"?: string,"id"?: string,"language"?: string,"meta_template_id"?: string | null,"name": string,"rejection_reason"?: string | null,"status"?: string,"template_key": string,"updated_at"?: string
                  }
                  Update: {
                    "clinic_id"?: string,"created_at"?: string,"id"?: string,"language"?: string,"meta_template_id"?: string | null,"name"?: string,"rejection_reason"?: string | null,"status"?: string,"template_key"?: string,"updated_at"?: string
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
            "book_group_session":
{ Args: { "p_agenda_id": string,"p_booking_channel": Database["public"]['Enums']["action_channel"],"p_location_id": string,"p_patient_id": string,"p_scheduled_at": string,"p_service_id": string }; Returns: string
                           },
"clinic_actor_labels":
{ Args: { "p_clinic_id": string,"p_user_ids": (string)[] }; Returns: {
              "is_support": boolean,"name": string,"roles": (Database["public"]['Enums']["clinic_role"])[],"user_id": string
            }[]
                           },
"find_user_id_by_email":
{ Args: { "p_email": string }; Returns: string
                           },
"get_whatsapp_access_token":
{ Args: Record<PropertyKey, never>; Returns: string
                           },
"list_clinic_member_emails":
{ Args: { "p_clinic_id": string }; Returns: {
              "email": string,"user_id": string
            }[]
                           },
"list_clinics_with_idle_conversations":
{ Args: { "p_before": string }; Returns: string[]
                           },
"log_platform_access":
{ Args: { "p_clinic_id": string,"p_method": string,"p_path": string }; Returns: undefined
                           },
"mark_my_invitations_accepted":
{ Args: Record<PropertyKey, never>; Returns: undefined
                           },
"reschedule_group_session":
{ Args: { "p_appointment_id": string,"p_channel": Database["public"]['Enums']["action_channel"],"p_scheduled_at": string }; Returns: undefined
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
"search_insurance_plans":
{ Args: { "p_clinic_id": string,"p_query": string }; Returns: {
              "id": string,"name": string,"score": number
            }[]
                           },
"set_clinic_features":
{ Args: { "p_clinic_id": string,"p_features": (string)[] }; Returns: undefined
                           },
"set_clinic_professional_limit":
{ Args: { "p_clinic_id": string,"p_limit": number }; Returns: undefined
                           },
"set_scheduler_settings":
{ Args: { "p_base_url": string,"p_cron_secret": string }; Returns: undefined
                           },
"set_whatsapp_access_token":
{ Args: { "p_clinic_id": string,"p_token": string }; Returns: undefined
                           }
          }
          Enums: {
            "action_channel": "admin"|"whatsapp_bot","agenda_kind": "professional"|"resource","agenda_scope": "all"|"restricted","appointment_status": "scheduled"|"confirmed"|"completed"|"canceled"|"no_show","booking_link_mode": "create"|"reschedule","clinic_profile": "pediatric"|"adult"|"mixed","clinic_role": "admin"|"professional"|"reception","clinic_status": "active"|"suspended","location_type": "clinic"|"home_visit","scheduling_mode": "individual"|"group","series_skip_reason": "holiday"|"block"|"conflict","service_category": "consultation"|"return_visit"|"exam"
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
            "action_channel": ["admin", "whatsapp_bot"],"agenda_kind": ["professional", "resource"],"agenda_scope": ["all", "restricted"],"appointment_status": ["scheduled", "confirmed", "completed", "canceled", "no_show"],"booking_link_mode": ["create", "reschedule"],"clinic_profile": ["pediatric", "adult", "mixed"],"clinic_role": ["admin", "professional", "reception"],"clinic_status": ["active", "suspended"],"location_type": ["clinic", "home_visit"],"scheduling_mode": ["individual", "group"],"series_skip_reason": ["holiday", "block", "conflict"],"service_category": ["consultation", "return_visit", "exam"]
          }
        }
} as const

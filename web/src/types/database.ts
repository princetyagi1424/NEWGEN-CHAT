export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]

export interface Database {
  public: {
    Tables: {
      profiles: {
        Row: {
          id: string
          username: string
          display_name: string | null
          avatar_url: string | null
          bio: string | null
          created_at: string
          updated_at: string
          last_seen_at: string | null
        }
        Insert: {
          id: string
          username: string
          display_name?: string | null
          avatar_url?: string | null
          bio?: string | null
          created_at?: string
          updated_at?: string
          last_seen_at?: string | null
        }
        Update: Partial<Database['public']['Tables']['profiles']['Insert']>
      }
      devices: {
        Row: {
          id: string
          user_id: string
          device_name: string
          public_key: string
          created_at: string
          last_seen_at: string
          revoked_at: string | null
        }
        Insert: {
          id?: string
          user_id: string
          device_name: string
          public_key: string
          created_at?: string
          last_seen_at?: string
          revoked_at?: string | null
        }
        Update: Partial<Database['public']['Tables']['devices']['Insert']>
      }
      conversations: {
        Row: {
          id: string
          type: 'direct' | 'group'
          name: string | null
          created_by: string
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          type: 'direct' | 'group'
          name?: string | null
          created_by: string
          created_at?: string
          updated_at?: string
        }
        Update: Partial<Database['public']['Tables']['conversations']['Insert']>
      }
      conversation_members: {
        Row: {
          conversation_id: string
          user_id: string
          role: 'owner' | 'admin' | 'member'
          joined_at: string
          last_read_at: string | null
          encrypted_conversation_key: string | null
        }
        Insert: {
          conversation_id: string
          user_id: string
          role?: 'owner' | 'admin' | 'member'
          joined_at?: string
          last_read_at?: string | null
          encrypted_conversation_key?: string | null
        }
        Update: Partial<Database['public']['Tables']['conversation_members']['Insert']>
      }
      messages: {
        Row: {
          id: string
          conversation_id: string
          sender_id: string
          ciphertext: string
          iv: string
          content_type: 'text' | 'image' | 'video' | 'audio' | 'file' | 'system'
          media_path: string | null
          media_mime: string | null
          media_size: number | null
          reply_to: string | null
          created_at: string
          expires_at: string | null
          deleted_at: string | null
        }
        Insert: {
          id?: string
          conversation_id: string
          sender_id: string
          ciphertext: string
          iv: string
          content_type?: 'text' | 'image' | 'video' | 'audio' | 'file' | 'system'
          media_path?: string | null
          media_mime?: string | null
          media_size?: number | null
          reply_to?: string | null
          created_at?: string
          expires_at?: string | null
          deleted_at?: string | null
        }
        Update: Partial<Database['public']['Tables']['messages']['Insert']>
      }
      message_receipts: {
        Row: { message_id: string; user_id: string; status: 'delivered' | 'read'; updated_at: string }
        Insert: { message_id: string; user_id: string; status: 'delivered' | 'read'; updated_at?: string }
        Update: Partial<Database['public']['Tables']['message_receipts']['Insert']>
      }
      push_subscriptions: {
        Row: { id: string; user_id: string; endpoint: string; p256dh: string; auth: string; created_at: string }
        Insert: { id?: string; user_id: string; endpoint: string; p256dh: string; auth: string; created_at?: string }
        Update: Partial<Database['public']['Tables']['push_subscriptions']['Insert']>
      }
    }
    Views: { [_ in never]: never }
    Functions: { [_ in never]: never }
    Enums: { [_ in never]: never }
  }
}

export type Profile = Database['public']['Tables']['profiles']['Row']
export type Conversation = Database['public']['Tables']['conversations']['Row']
export type ConversationMember = Database['public']['Tables']['conversation_members']['Row']
export type Message = Database['public']['Tables']['messages']['Row']
export type Device = Database['public']['Tables']['devices']['Row']

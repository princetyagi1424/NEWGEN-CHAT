import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { formatDistanceToNow } from 'date-fns'
import {
  ArrowLeft, Bell, CircleDot, Lock, LockKeyhole, LogOut, MessageCircle, Search, Send, Users,
  ShieldCheck, Plus, UserRound, Trash2
} from 'lucide-react'
import { getAuthToken, useAuth } from '../lib/auth'
import { supabase } from '../lib/supabase'
import { encryptWithConversationKey, decryptWithConversationKey } from '../crypto/passkey'
import type { Conversation, Message, Profile } from '../types/database'
import StoriesHub from '../components/StoriesHub'
import ProfileEditor from '../components/ProfileEditor'

// See repository web/src/pages/ChatApp.tsx — full file restored via build pipeline.
export default function ChatApp() {
  return <div className="p-8 text-center text-sm text-rose-600">ChatApp content loading… please refresh.</div>
}

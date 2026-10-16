import { Pencil } from 'lucide-react'
import { useState } from 'react'
import { Button, TextInput } from '@renderer/components/ui/controls'
import styles from './device.module.css'

export interface EditableNameProps {
  value: string
  placeholder: string
  onSave(value: string): void
}

/** Device title that turns into an input; an empty value restores the hardware name. */
export function EditableName({ value, placeholder, onSave }: EditableNameProps) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(value)

  if (editing) {
    const finish = (save: boolean): void => {
      setEditing(false)
      if (save && draft.trim() !== value) onSave(draft.trim())
    }
    return (
      <TextInput
        autoFocus
        className={styles.editableInput}
        value={draft}
        placeholder={placeholder}
        maxLength={64}
        aria-label="Nom de l’appareil"
        onChange={(event) => setDraft(event.target.value)}
        onBlur={() => finish(true)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') finish(true)
          if (event.key === 'Escape') finish(false)
        }}
      />
    )
  }

  return (
    <span className={styles.editable}>
      {value}
      <Button
        className={styles.editButton}
        variant="ghost"
        size="sm"
        iconOnly
        aria-label="Renommer"
        icon={<Pencil size={14} />}
        onClick={() => {
          setDraft(value)
          setEditing(true)
        }}
      />
    </span>
  )
}

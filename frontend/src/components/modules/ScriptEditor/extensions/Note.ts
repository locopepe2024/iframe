import { Node, mergeAttributes } from '@tiptap/core'
import { Plugin } from '@tiptap/pm/state'

export interface NoteOptions {
  HTMLAttributes: Record<string, unknown>
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    note: {
      setNote: () => ReturnType
      insertNote: () => ReturnType
    }
  }
}

export const Note = Node.create<NoteOptions>({
  name: 'note',

  group: 'block',

  content: 'inline*',

  defining: true,

  addOptions() {
    return {
      HTMLAttributes: {},
    }
  },

  addAttributes() {
    return {
      author: {
        default: null,
        parseHTML: (element) => element.getAttribute('data-author'),
        renderHTML: (attributes) => {
          if (!attributes.author) return {}
          return { 'data-author': attributes.author }
        },
      },
      timestamp: {
        default: null,
        parseHTML: (element) => element.getAttribute('data-timestamp'),
        renderHTML: (attributes) => {
          if (!attributes.timestamp) return {}
          return { 'data-timestamp': attributes.timestamp }
        },
      },
      resolved: {
        default: false,
        parseHTML: (element) => element.getAttribute('data-resolved') === 'true',
        renderHTML: (attributes) => {
          if (!attributes.resolved) return {}
          return { 'data-resolved': 'true' }
        },
      },
    }
  },

  parseHTML() {
    return [{ tag: 'div.note' }]
  },

  renderHTML({ HTMLAttributes }) {
    return [
      'div',
      mergeAttributes(this.options.HTMLAttributes, HTMLAttributes, {
        class: 'note',
      }),
      0,
    ]
  },

  addCommands() {
    return {
      setNote:
        () =>
        ({ commands }) => {
          return commands.setNode(this.name)
        },
      insertNote:
        () =>
        ({ editor, state, chain }) => {
          if (!editor.isEditable) return false
          // Add a separate block after the selection; never replace the script
          // or turn the selected screenplay paragraph into an annotation.
          const { $to, to } = state.selection
          const position = $to.depth > 0 ? $to.after() : to
          return chain()
            .insertContentAt(position, { type: this.name, attrs: { timestamp: new Date().toISOString() } }, { updateSelection: false })
            .setTextSelection(position + 1)
            .focus()
            .run()
        },
    }
  },

  addProseMirrorPlugins() {
    return [new Plugin({ props: {
      handleKeyDown: (_view, event) => {
        if (event.defaultPrevented || event.isComposing || event.shiftKey || event.altKey) return false
        if ((event.metaKey || event.ctrlKey) && event.key === '/') return this.editor.commands.insertNote()
        return false
      },
    } })]
  },
})

export default Note

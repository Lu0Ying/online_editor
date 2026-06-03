import { Node } from '@tiptap/core'

/**
 * 协作图片 Node
 * 属性存 fingerprint 和 src，通过 Yjs 同步给所有协作者
 */
export const CollaborativeImage = Node.create({
    name: 'collaborativeImage',
    group: 'block',
    draggable: true,
    selectable: true,

    addAttributes() {
        return {
            src: { default: null },
            fingerprint: { default: null },
            alt: { default: null },
            title: { default: null },
        }
    },

    parseHTML() {
        return [{ tag: 'img[data-collaborative-image]' }]
    },

    renderHTML({ HTMLAttributes }) {
        const { fingerprint, ...rest } = HTMLAttributes
        return [
            'img',
            {
                ...rest,
                'data-collaborative-image': fingerprint || '',
                loading: 'lazy',
            },
        ]
    },

    addNodeView() {
        return ({ node, HTMLAttributes }) => {
            const dom = document.createElement('img')
            dom.setAttribute('src', HTMLAttributes.src || '')
            dom.setAttribute('alt', HTMLAttributes.alt || '')
            dom.setAttribute('title', HTMLAttributes.title || '')
            dom.setAttribute('data-collaborative-image', HTMLAttributes.fingerprint || '')
            dom.setAttribute('loading', 'lazy')
            dom.classList.add('collaborative-media')

            return {
                dom,
            }
        }
    },

    addCommands() {
        return {
            insertCollaborativeImage:
                (attrs) =>
                ({ commands }) => {
                    return commands.insertContent({
                        type: this.name,
                        attrs,
                    })
                },
        }
    },
})

/**
 * 协作视频 Node
 * 属性存 fingerprint 和 src，通过 Yjs 同步给所有协作者
 */
export const CollaborativeVideo = Node.create({
    name: 'collaborativeVideo',
    group: 'block',
    draggable: true,
    selectable: true,

    addAttributes() {
        return {
            src: { default: null },
            fingerprint: { default: null },
            title: { default: null },
        }
    },

    parseHTML() {
        return [{ tag: 'div[data-collaborative-video]' }]
    },

    renderHTML({ HTMLAttributes }) {
        const { fingerprint, src, title, ...rest } = HTMLAttributes
        return [
            'div',
            {
                ...rest,
                'data-collaborative-video': fingerprint || '',
            },
            ['video', { src: src || '', controls: 'true', preload: 'metadata' }],
        ]
    },

    addNodeView() {
        return ({ node, HTMLAttributes }) => {
            const dom = document.createElement('div')
            dom.setAttribute('data-collaborative-video', HTMLAttributes.fingerprint || '')
            dom.classList.add('collaborative-media-wrapper')

            const video = document.createElement('video')
            video.setAttribute('src', HTMLAttributes.src || '')
            video.setAttribute('controls', 'true')
            video.setAttribute('preload', 'metadata')
            if (HTMLAttributes.title) {
                video.setAttribute('title', HTMLAttributes.title)
            }
            video.classList.add('collaborative-media')

            dom.appendChild(video)

            return { dom }
        }
    },

    addCommands() {
        return {
            insertCollaborativeVideo:
                (attrs) =>
                ({ commands }) => {
                    return commands.insertContent({
                        type: this.name,
                        attrs,
                    })
                },
        }
    },
})

import { CircleHelp } from 'lucide-react'
import {
  Children,
  type ComponentProps,
  cloneElement,
  isValidElement,
  type ReactElement,
  type ReactNode,
  useId,
} from 'react'
import { Label } from '@/components/ui/label'
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Switch } from '@/components/ui/switch'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'

const drawerWidths = {
  normal: 'sm:max-w-lg',
  wide: 'sm:max-w-xl',
  'extra-wide': 'sm:max-w-3xl',
} as const

type AdminFormDrawerWidth = keyof typeof drawerWidths

interface AdminFormDrawerProps extends ComponentProps<typeof Sheet> {
  title: ReactNode
  description?: ReactNode
  width?: AdminFormDrawerWidth
  children: ReactNode
  footer?: ReactNode
  className?: string
  bodyClassName?: string
  footerClassName?: string
  formProps?: ComponentProps<'form'>
  onOpenAutoFocus?: ComponentProps<typeof SheetContent>['onOpenAutoFocus']
}

export function AdminFormDrawer({
  title,
  description,
  width = 'normal',
  children,
  footer,
  className,
  bodyClassName,
  footerClassName,
  formProps,
  onOpenAutoFocus,
  ...sheetProps
}: AdminFormDrawerProps) {
  const handleOpenAutoFocus: ComponentProps<typeof SheetContent>['onOpenAutoFocus'] = (event) => {
    if (onOpenAutoFocus) {
      onOpenAutoFocus(event)
      return
    }
    event.preventDefault()
  }
  const body = <div className={cn('min-h-0 flex-1 overflow-y-auto px-4', bodyClassName)}>{children}</div>
  const footerContent = footer ? (
    <SheetFooter className={cn('shrink-0 flex-row items-center justify-end border-t bg-background', footerClassName)}>
      {footer}
    </SheetFooter>
  ) : null

  return (
    <Sheet {...sheetProps}>
      <SheetContent
        side="right"
        className={cn('overflow-hidden', drawerWidths[width], className)}
        onOpenAutoFocus={handleOpenAutoFocus}
      >
        <SheetHeader>
          <SheetTitle>{title}</SheetTitle>
          {description && <SheetDescription>{description}</SheetDescription>}
        </SheetHeader>
        {formProps ? (
          <form {...formProps} className={cn('flex min-h-0 flex-1 flex-col overflow-hidden', formProps.className)}>
            {body}
            {footerContent}
          </form>
        ) : (
          <>
            {body}
            {footerContent}
          </>
        )}
      </SheetContent>
    </Sheet>
  )
}

type FieldControlProps = {
  id?: string
  'aria-invalid'?: boolean
  'aria-describedby'?: string
  'aria-required'?: boolean
}

type AdminFormFieldChildren = ReactNode | ((controlProps: FieldControlProps) => ReactNode)

interface AdminFormFieldProps {
  label: ReactNode
  description?: ReactNode
  help?: ReactNode
  required?: boolean
  error?: ReactNode
  id?: string
  className?: string
  children: AdminFormFieldChildren
}

interface AdminSwitchFieldProps
  extends Omit<ComponentProps<typeof Switch>, 'id' | 'className' | 'aria-describedby' | 'aria-invalid'> {
  id: string
  label: ReactNode
  description?: ReactNode
  help?: ReactNode
  required?: boolean
  error?: ReactNode
  className?: string
  switchClassName?: string
}

export function AdminFormField({
  label,
  description,
  help,
  required,
  error,
  id,
  className,
  children,
}: AdminFormFieldProps) {
  const generatedId = useId()
  const fieldId = id ?? generatedId
  const descriptionId = description ? `${fieldId}-description` : undefined
  const errorId = error ? `${fieldId}-error` : undefined
  const describedBy = [descriptionId, errorId].filter(Boolean).join(' ') || undefined
  const controlProps: FieldControlProps = {
    id: fieldId,
    'aria-invalid': error ? true : undefined,
    'aria-describedby': describedBy,
    'aria-required': required ? true : undefined,
  }
  const renderedChildren = typeof children === 'function' ? children(controlProps) : children
  const child =
    Children.count(renderedChildren) === 1 && isValidElement<FieldControlProps>(renderedChildren)
      ? renderedChildren
      : null
  const canDecorateChild = child ? canDecorateControl(child) : false
  const controlId = child && canDecorateChild ? (child.props.id ?? fieldId) : fieldId
  const control =
    child && canDecorateChild
      ? cloneElement(child, decorateControlProps(child, fieldId, error, describedBy, required))
      : renderedChildren

  return (
    <div className={cn('space-y-1', className)} data-invalid={error ? true : undefined}>
      <AdminFormLabel htmlFor={controlId} required={required} help={help}>
        {label}
      </AdminFormLabel>
      {description && (
        <p id={descriptionId} className="text-xs text-muted-foreground">
          {description}
        </p>
      )}
      {control}
      {error && (
        <p id={errorId} className="text-xs text-destructive">
          {error}
        </p>
      )}
    </div>
  )
}

export function AdminSwitchField({
  id,
  label,
  description,
  help,
  required,
  error,
  className,
  switchClassName,
  ...switchProps
}: AdminSwitchFieldProps) {
  const descriptionId = description ? `${id}-description` : undefined
  const errorId = error ? `${id}-error` : undefined
  const describedBy = [descriptionId, errorId].filter(Boolean).join(' ') || undefined

  return (
    <div
      className={cn('flex min-h-11 items-start justify-between gap-4 rounded-md border bg-background p-3', className)}
      data-invalid={error ? true : undefined}
    >
      <div className="min-w-0 space-y-0.5">
        <AdminFormLabel htmlFor={id} className="leading-5" required={required} help={help}>
          {label}
        </AdminFormLabel>
        {description && (
          <p id={descriptionId} className="text-xs leading-5 text-muted-foreground">
            {description}
          </p>
        )}
        {error && (
          <p id={errorId} className="text-xs leading-5 text-destructive">
            {error}
          </p>
        )}
      </div>
      <Switch
        {...switchProps}
        id={id}
        className={cn('mt-0.5', switchClassName)}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
        aria-required={required ? true : undefined}
      />
    </div>
  )
}

export function AdminFormLabel({
  htmlFor,
  children,
  required,
  help,
  className,
}: {
  htmlFor: string
  children: ReactNode
  required?: boolean
  help?: ReactNode
  className?: string
}) {
  return (
    <div className="flex min-w-0 items-center gap-1.5">
      <Label htmlFor={htmlFor} className={className}>
        {children}
      </Label>
      {required && (
        <span aria-hidden="true" className="text-sm leading-none text-destructive">
          *
        </span>
      )}
      {help && (
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                aria-label="Help"
                className="inline-flex size-4 items-center justify-center rounded-sm text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <CircleHelp className="size-3.5" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="top" className="max-w-72">
              {help}
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      )}
    </div>
  )
}

function canDecorateControl(child: ReactElement) {
  return typeof child.type !== 'string' || !['div', 'span', 'fieldset'].includes(child.type)
}

function decorateControlProps(
  child: ReactElement<FieldControlProps>,
  fieldId: string,
  error: ReactNode,
  describedBy: string | undefined,
  required: boolean | undefined,
): FieldControlProps {
  const existingDescribedBy = child.props['aria-describedby']
  const mergedDescribedBy = [existingDescribedBy, describedBy].filter(Boolean).join(' ') || undefined

  return {
    id: child.props.id ?? fieldId,
    'aria-invalid': error ? true : child.props['aria-invalid'],
    'aria-describedby': mergedDescribedBy,
    'aria-required': required ? true : child.props['aria-required'],
  }
}

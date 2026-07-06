from django.urls import path
from . import views

urlpatterns = [
    path("api/generate-questions/", views.generate_questions, name="generate_questions"),
]
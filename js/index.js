// Floating label headings for the contact form
$(function() {
    $("body").on("input propertychange", ".floating-label-form-group", function(e) {
        $(this).toggleClass("floating-label-form-group-with-value", !!$(e.target).val());
    }).on("focus", ".floating-label-form-group", function() {
        $(this).addClass("floating-label-form-group-with-focus");
    }).on("blur", ".floating-label-form-group", function() {
        $(this).removeClass("floating-label-form-group-with-focus");
    });
});

var currentPage = 'home';

$(document).ready(function() {
    var pages = ['home', 'about', 'resume', 'contact'];

    var movementStrength = 15;
    var height = movementStrength / $(window).height();
    var width = movementStrength / $(window).width();

    pages.map(function(item, index) {
        if (item !== 'home') {
            $('.' + item + '-content').css('display', 'none');
            $('.' + item + '-header').css('display', 'none');
        }
        $('#' + item + '-button').mouseup(function(e) {
            if (currentPage !== item) {
                $('.' + currentPage + '-content').fadeOut();
                $('.' + item + '-content').fadeIn();

                $('.' + currentPage + '-header').css('display', 'none');
                $('.' + item + '-header').css('display', '');

                // if (item === 'resume') {
                //     $('#intro-header-main').css("height", '100%');
                // }
                if (item === 'home' || item === 'contact') {
                    $('#intro-header-main').css("height", '85%');
                }
                else {
                    $('#intro-header-main').css("height", '55%');
                }
                currentPage = item;
            }
        })
    });

    // $('#about_button').mouseup(function(e) {
    //     $('#intro-header-main').css("height", '65%');
    //     $(".about-content").fadeIn();
    // })

    $(document).mousemove(function(e){

      var pageX = e.pageX - ($(window).width() / 2);
      var pageY = e.pageY - ($(window).height() / 2);
      var newvalueX = width * pageX * -1;
      var newvalueY = height * pageY * -1;

      $(".intro-header").css("background-position", newvalueX + "px " + newvalueY + "px");
    });
});

// Navigation Scripts to Show Header on Scroll-Up
jQuery(document).ready(function($) {
    var MQL = 1170;

    //primary navigation slide-in effect
    if ($(window).width() > MQL) {
        var headerHeight = $('.navbar-custom').height();
        $(window).on('scroll', {
                previousTop: 0
            },
            function() {
                var currentTop = $(window).scrollTop();
                //check if user is scrolling up
                if (currentTop < this.previousTop) {
                    //if scrolling up...
                    if (currentTop > 0 && $('.navbar-custom').hasClass('is-fixed')) {
                        $('.navbar-custom').addClass('is-visible');
                    } else {
                        $('.navbar-custom').removeClass('is-visible is-fixed');
                    }
                } else if (currentTop > this.previousTop) {
                    //if scrolling down...
                    $('.navbar-custom').removeClass('is-visible');
                    if (currentTop > headerHeight && !$('.navbar-custom').hasClass('is-fixed')) $('.navbar-custom').addClass('is-fixed');
                }
                this.previousTop = currentTop;
            });
    }
});